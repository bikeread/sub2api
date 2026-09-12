// 降智检测执行器：开通巡检通道 → 三次挑战 → 归因 → 判定 → 落历史。

import { generateChallenges } from './challenges';
import { analyzeOutputs } from './fingerprint';
import { judgeAttribution } from './judge';
import { ensureProbeRoute } from './provision';
import { appendHistory, type HistoryEntry } from './store';
import {
  getAccountGroupIds,
  getAccountSupportedModels,
  runChatCompletion,
  setAccountSchedulable,
  updateAccount,
  type AdminAccount,
} from './sub2api-admin';
import type { AttributionResult, DetectionVerdict } from './types';
import bankJson from './data/unified_bank.json';
import type { ModelTraceBank } from './types';

const bank = bankJson as unknown as ModelTraceBank;

// 指纹库可归因的 GPT 模型，按能力从强到弱
const BANK_MODEL_PRIORITY = [
  'gpt-6-astra',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
];

/** 未显式指定时，自动选账号能力清单里最强的可归因模型。 */
function resolveClaimedModel(
  requested: string | undefined,
  supported: string[],
): string {
  const trimmed = (requested ?? '').trim();
  if (trimmed) {
    if (supported.length > 0 && !supported.includes(trimmed)) {
      throw new Error(
        `该账号能力清单不含 ${trimmed}（支持：${supported.join('、')}），请改填支持的模型或留空自动选择`,
      );
    }
    return trimmed;
  }
  for (const candidate of BANK_MODEL_PRIORITY) {
    if (supported.includes(candidate)) return candidate;
  }
  if (supported.length > 0) {
    throw new Error(
      `该账号能力清单（${supported.join('、')}）里没有指纹库可归因的模型`,
    );
  }
  // 能力清单未知时退回默认
  return BANK_MODEL_PRIORITY[0];
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

export interface DetectionOutcome {
  entry: HistoryEntry;
  attribution: {
    top: { model: string; displayName: string; probability: number }[];
    usedOutputs: number;
    diagnostics: AttributionResult['diagnostics'];
    familyProbability: number;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetry(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await runChatCompletion(apiKey, model, prompt);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : '';
      const status = Number(/HTTP (\d+)/.exec(message)?.[1]);
      if (!RETRYABLE.has(status) || attempt === MAX_ATTEMPTS) break;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

export async function detectAccount(
  token: string,
  account: AdminAccount,
  requestedModel?: string,
): Promise<DetectionOutcome> {
  if (account.status !== 'active') {
    throw new Error(`账号状态为 ${account.status}，仅支持检测 active 账号`);
  }
  const supported = await getAccountSupportedModels(token, account.id);
  const model = resolveClaimedModel(requestedModel, supported);
  const route = await ensureProbeRoute(token, account);

  // 调度开关关闭的账号（多半正是被隔离的降智号）必须照常可测：
  // 检测窗口内临时把账号隔离到巡检分组并打开调度，测完立即恢复。
  // 窗口期内账号不在任何生产分组，生产流量零接触。
  const needsBypass = account.schedulable === false;
  let originalGroupIds: number[] | null = null;
  if (needsBypass) {
    originalGroupIds = await getAccountGroupIds(token, account.id);
    await updateAccount(token, account.id, { group_ids: [route.groupId] });
    await setAccountSchedulable(token, account.id, true);
  }

  let answers: { text: string; expectedCount: number }[];
  try {
    const challenges = generateChallenges(3);
    answers = [];
    for (const challenge of challenges) {
      const text = await runWithRetry(route.apiKey, model, challenge.prompt);
      answers.push({ text, expectedCount: challenge.expectedCount });
    }
  } finally {
    if (needsBypass && originalGroupIds) {
      // 恢复优先于检测结论；失败也要尽量还原账号调度状态
      await setAccountSchedulable(token, account.id, false).catch(
        () => undefined,
      );
      await updateAccount(token, account.id, {
        group_ids: originalGroupIds,
      }).catch(() => undefined);
    }
  }

  const attribution = analyzeOutputs(answers, bank);
  const verdict: DetectionVerdict = judgeAttribution(attribution, model);
  const entry: HistoryEntry = {
    accountId: account.id,
    accountName: account.name,
    model,
    verdict: verdict.verdict,
    reason: verdict.reason,
    prediction: attribution.prediction,
    probability: attribution.probability,
    top: attribution.results
      .slice(0, 3)
      .map((r) => ({ model: r.model, probability: r.probability })),
    usedOutputs: attribution.usedOutputs,
    detectedAt: new Date().toISOString(),
  };
  await appendHistory(entry);

  return {
    entry,
    attribution: {
      top: attribution.results.slice(0, 3).map((r) => ({
        model: r.model,
        displayName: r.displayName,
        probability: r.probability,
      })),
      usedOutputs: attribution.usedOutputs,
      diagnostics: attribution.diagnostics,
      familyProbability: attribution.familyProbability,
    },
  };
}
