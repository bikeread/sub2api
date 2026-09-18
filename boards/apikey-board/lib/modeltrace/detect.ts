import { FINGERPRINT_MODELS, type ReasoningEffort } from './options';
// 降智检测执行器：开通巡检通道 → 三次挑战 → 归因 → 判定 → 落历史。

import { generateChallenges } from './challenges';
import { analyzeOutputs } from './fingerprint';
import { judgeAttribution } from './judge';
import { ensureProbeRoute } from './provision';
import { appendHistory } from './store';
import {
  getAccountGroupIds,
  getAccountModelCatalog,
  runChatCompletion,
  runChatCompletionResult,
  setAccountSchedulable,
  updateAccount,
  type AdminAccount,
} from './sub2api-admin';
import type { DetectionOutcome, FingerprintHistoryEntry } from './types';
import {
  DetectionError,
  parseDetectionRequest,
  type DetectionMethod,
} from './request';
export type { DetectionOutcome } from './types';
import bankJson from './data/unified_bank.json';
import type { ModelTraceBank } from './types';

const bank = bankJson as unknown as ModelTraceBank;

// 指纹库可归因的 GPT 模型，按能力从强到弱
const BANK_MODEL_PRIORITY = FINGERPRINT_MODELS;

/** 未显式指定时，自动选账号能力清单里最强的可归因模型。 */
function resolveClaimedModel(
  requested: string | undefined,
  candidates: string[],
): string {
  if (!candidates.length)
    throw new DetectionError(
      '账号尚无已同步的模型能力数据，请在账号管理中同步后重试',
    );
  const trimmed = (requested ?? '').trim();
  if (trimmed) {
    if (!candidates.includes(trimmed)) {
      throw new DetectionError(
        `该账号能力清单不含 ${trimmed}（支持：${candidates.join('、')}），请刷新模型清单后重新选择`,
      );
    }
    return trimmed;
  }
  for (const candidate of BANK_MODEL_PRIORITY) {
    if (candidates.includes(candidate)) return candidate;
  }
  throw new DetectionError(
    `该账号已同步模型（${candidates.join('、')}）里没有指纹库可归因的模型`,
  );
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

// Shared across Next route bundles in the single-process board deployment.
const runtime = globalThis as typeof globalThis & {
  modelTraceRunning?: Set<number>;
};
const running = (runtime.modelTraceRunning ??= new Set<number>());

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetry(
  apiKey: string,
  model: string,
  prompt: string,
  reasoningEffort?: ReasoningEffort,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await runChatCompletion(apiKey, model, prompt, reasoningEffort);
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
  method: DetectionMethod = 'fingerprint',
  prompt?: string,
  reasoningEffort?: ReasoningEffort,
): Promise<DetectionOutcome> {
  const request = parseDetectionRequest({
    account_id: account.id,
    model: requestedModel,
    method,
    prompt,
    reasoning_effort: reasoningEffort,
  });
  if (account.status !== 'active')
    throw new DetectionError(
      `账号状态为 ${account.status}，仅支持检测 active 账号`,
    );
  if (running.has(account.id))
    throw new DetectionError('该账号正在检测，请等待当前检测完成', 409);
  running.add(account.id);
  try {
    return await executeDetection(
      token,
      account,
      request.model,
      method,
      request.prompt,
      request.reasoning_effort,
    );
  } finally {
    running.delete(account.id);
  }
}

async function executeDetection(
  token: string,
  account: AdminAccount,
  requestedModel: string | undefined,
  method: DetectionMethod,
  prompt?: string,
  reasoningEffort?: ReasoningEffort,
): Promise<DetectionOutcome> {
  const startedAt = Date.now();
  const catalog = await getAccountModelCatalog(token, account.id);
  const model = resolveClaimedModel(
    requestedModel,
    catalog.models.map((item) => item.id),
  );
  const capability = catalog.models.find((item) => item.id === model);
  if (
    reasoningEffort &&
    !capability?.reasoningEfforts.includes(reasoningEffort)
  ) {
    throw new DetectionError(
      `模型 ${model} 的同步数据未列出思维强度 ${reasoningEffort}，请重新同步或跟随模型默认`,
    );
  }
  const needsBypass = account.schedulable === false;
  // Snapshot before provisioning so even preparation failures restore original membership.
  const originalGroupIds = needsBypass
    ? await getAccountGroupIds(token, account.id)
    : null;
  let preparationStarted = false;
  let outcome: DetectionOutcome | undefined;
  let executionError: unknown;
  try {
    preparationStarted = true;
    const route = await ensureProbeRoute(token, account);
    if (needsBypass) {
      await updateAccount(token, account.id, { group_ids: [route.groupId] });
      await setAccountSchedulable(token, account.id, true);
    }
    const base = {
      accountId: account.id,
      accountName: account.name,
      model,
      detectedAt: new Date().toISOString(),
      ...(reasoningEffort ? { reasoningEffort } : {}),
    };
    if (method === 'prompt') {
      // One request, no automatic retry or scoring in the manual inspection mode.
      const response = await runChatCompletionResult(
        route.apiKey,
        model,
        prompt!,
        reasoningEffort,
      );
      outcome = {
        entry: {
          ...base,
          method: 'prompt',
          prompt: prompt!,
          output: response.text,
          finishReason: response.finishReason,
        },
      };
    } else {
      const answers = [];
      for (const challenge of generateChallenges(3)) {
        const text = await runWithRetry(
          route.apiKey,
          model,
          challenge.prompt,
          reasoningEffort,
        );
        answers.push({ text, expectedCount: challenge.expectedCount });
      }
      const result = analyzeOutputs(answers, bank);
      const attribution = {
        top: result.results.slice(0, 3).map((r) => ({
          model: r.model,
          displayName: r.displayName,
          probability: r.probability,
        })),
        usedOutputs: result.usedOutputs,
        diagnostics: result.diagnostics,
        familyProbability: result.familyProbability,
      };
      const entry: FingerprintHistoryEntry = {
        ...base,
        method: 'fingerprint',
        ...judgeAttribution(result, model),
        prediction: result.prediction,
        probability: result.probability,
        top: attribution.top,
        usedOutputs: result.usedOutputs,
        attribution,
      };
      outcome = { entry, attribution };
    }
  } catch (error) {
    executionError = error;
  }
  if (needsBypass && originalGroupIds && preparationStarted) {
    try {
      // Fail closed: never reattach production groups if disabling scheduling fails.
      await setAccountSchedulable(token, account.id, false);
    } catch (error) {
      throw new Error(
        `恢复失败：无法关闭账号调度，未恢复原分组，请检查账号 #${account.id}。${errorMessage(error)}${executionError ? `；检测错误：${errorMessage(executionError)}` : ''}`,
      );
    }
    try {
      await updateAccount(token, account.id, { group_ids: originalGroupIds });
    } catch (error) {
      throw new Error(
        `恢复失败：调度已关闭，但原分组未恢复，请检查账号 #${account.id}。${errorMessage(error)}${executionError ? `；检测错误：${errorMessage(executionError)}` : ''}`,
      );
    }
  }
  if (executionError) throw executionError;
  if (!outcome) throw new Error('检测没有产生结果');
  outcome.entry.durationMs = Date.now() - startedAt;
  outcome.entry.detectedAt = new Date().toISOString();
  await appendHistory(outcome.entry);
  return outcome;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
