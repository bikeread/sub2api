import type {
  QuotaCalibration,
  QuotaForecastPoint,
  QuotaHistoryPoint,
  QuotaPercentBand,
  QuotaProjectionAccount,
  QuotaProjectionBucket,
  QuotaProjectionState,
  QuotaProjectionView,
  QuotaVerdict,
} from '@/lib/types';

/**
 * Codex 7d 配额的"够不够"推算。全部为纯函数（vitest 只收 lib/**.test.ts）。
 *
 * 方法（反推锚定法）：上游只给一个整数百分比快照、没有任何百分比历史，所以用
 * usage_logs 重建窗口内的 token 消耗曲线，再用当前快照把它锚定：
 *   tokensPerPercent = 窗口内 token / 当前 used%
 * 历史百分比序列的终点因此按定义等于当前快照；未来是对近期速率的**线性外推**。
 *
 * 三个必须如实反映给用户的前提：
 *  1. 这是估算。上游百分比是整数（±0.5 量化误差），且百分比与 token 并非线性
 *     （缓存读取很可能被上游打折：实测 free 账号 30 天 5.6 亿 token 仍显示 0%）。
 *  2. 消耗极不均。实测某账号窗口内 3,590 万 token 绝大部分集中在最近 2 小时，
 *     所以"回看窗口长度"会显著改变结论 —— 必须把速率口径显示出来。
 *  3. 窗口长度不一定是 7 天（free 计划上报 30 天 / 43200 分钟），一律以
 *     window_minutes 为准；取不到就降级 unknown，绝不假装是 7 天。
 */

export const DEFAULT_LOOKBACK_HOURS = 24;
export const MIN_LOOKBACK_HOURS = 1;
export const TIGHT_PERCENT = 85;
export const MAX_PERCENT = 100;
/** 有效时长太短就不外推（窗口刚开始时锚点没有意义） */
export const MIN_ELAPSED_HOURS = 1;

const HOUR_MS = 3_600_000;

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function startOfHourMs(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

/**
 * 量化区间：上游给整数百分比时真实值在 ±0.5 内；万一给了小数则取 0.1。
 * 返回三个换算系数：中枢、悲观（每 1% 对应更少 token ⇒ 同样的消耗推高更多百分点）、乐观。
 */
export function tokensPerPercentBand(
  tokensInWindow: number,
  usedPercent: number,
): { central: number; min: number; max: number; quantum: number } | null {
  if (!Number.isFinite(tokensInWindow) || tokensInWindow <= 0) return null;
  if (!Number.isFinite(usedPercent) || usedPercent <= 0) return null;
  const quantum = Number.isInteger(usedPercent) ? 1 : 0.1;
  const half = quantum / 2;
  return {
    central: tokensInWindow / usedPercent,
    min: tokensInWindow / (usedPercent + half),
    max: tokensInWindow / Math.max(usedPercent - half, half),
    quantum,
  };
}

/**
 * 近期速率（token/小时）。分母与分子严格对齐（spanMs = now - spanStart），
 * 回看长度 = min(24h, 窗口已过时长, 窗口长度)，至少 1 小时。
 */
export function trailingTokensPerHour(
  buckets: QuotaProjectionBucket[],
  nowMs: number,
  elapsedAnchorMs: number | null,
  windowMinutes: number | null,
): { tokensPerHour: number; lookbackHours: number; spanStartMs: number } | null {
  const elapsedHours =
    elapsedAnchorMs === null ? null : Math.max(0, (nowMs - elapsedAnchorMs) / HOUR_MS);
  const windowHours =
    windowMinutes !== null && windowMinutes > 0 ? windowMinutes / 60 : null;

  const caps = [DEFAULT_LOOKBACK_HOURS, elapsedHours, windowHours].filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  if (caps.length === 0) return null;

  const hours = Math.max(MIN_LOOKBACK_HOURS, Math.floor(Math.min(...caps)));
  const spanStartMs = startOfHourMs(nowMs) - (hours - 1) * HOUR_MS;
  const spanMs = nowMs - spanStartMs;
  if (spanMs < HOUR_MS) return null;

  const tokens = buckets
    .filter((b) => b.ts >= spanStartMs && b.ts <= nowMs)
    .reduce((sum, b) => sum + (Number.isFinite(b.tokens) ? b.tokens : 0), 0);
  return { tokensPerHour: (tokens / spanMs) * HOUR_MS, lookbackHours: hours, spanStartMs };
}

export function resolveQuotaVerdict(args: {
  usedPercent: number;
  /** 速率必须是 **token/小时**（不是百分点/小时），因为下面要除以"每 1% 对应多少 token" */
  tokensPerHour: number;
  hoursToReset: number;
  perPercentCentral: number;
  perPercentMin: number;
  perPercentMax: number;
}): { verdict: QuotaVerdict; percentAtReset: number; percentAtResetBand: QuotaPercentBand } {
  const {
    usedPercent,
    tokensPerHour,
    hoursToReset,
    perPercentCentral,
    perPercentMin,
    perPercentMax,
  } = args;
  const central = usedPercent + (tokensPerHour / perPercentCentral) * hoursToReset;
  // 每 1% 对应更少 token ⇒ 悲观上界；反之乐观
  const pessimistic = usedPercent + (tokensPerHour / perPercentMin) * hoursToReset;
  const optimistic = usedPercent + (tokensPerHour / perPercentMax) * hoursToReset;

  let verdict: QuotaVerdict;
  if (usedPercent >= MAX_PERCENT) verdict = 'not-enough';
  else if (optimistic >= MAX_PERCENT) verdict = 'not-enough';
  else if (pessimistic >= MAX_PERCENT) verdict = 'uncertain';
  else if (pessimistic >= TIGHT_PERCENT) verdict = 'tight';
  else verdict = 'enough';

  return {
    verdict,
    percentAtReset: central,
    percentAtResetBand: { min: optimistic, max: pessimistic },
  };
}

function baseView(
  account: QuotaProjectionAccount,
  state: QuotaProjectionState,
  partial: Partial<QuotaProjectionView> = {},
): QuotaProjectionView {
  return {
    accountId: account.accountId,
    accountName: account.accountName,
    planType: account.planType,
    state,
    verdict: 'unknown',
    calibration: 'unavailable',
    usedPercent: account.usedPercent,
    resetAtMs: toMs(account.resetAt),
    windowStartMs: toMs(account.windowStartAt),
    snapshotMs: toMs(account.snapshotAt),
    windowMinutes: account.windowMinutes,
    tokensInWindow: 0,
    tokensPerPercent: null,
    tokensPerPercentBand: null,
    ratePerHour: 0,
    lookbackHours: 0,
    rateSpanStartMs: null,
    percentAtReset: null,
    percentAtResetBand: null,
    exhaustAtMs: null,
    history: [],
    forecast: [],
    ...partial,
  };
}

export function buildQuotaProjection(
  account: QuotaProjectionAccount,
  nowMs: number,
  historyFloorMs: number | null = null,
): QuotaProjectionView {
  const resetAtMs = toMs(account.resetAt);
  const windowStartMs = toMs(account.windowStartAt);
  const snapshotMs = toMs(account.snapshotAt);
  const windowMinutes = account.windowMinutes;
  const usedPercent = account.usedPercent;
  const buckets = [...(account.buckets ?? [])].sort((a, b) => a.ts - b.ts);
  const tokensInWindow = buckets.reduce(
    (sum, b) => sum + (Number.isFinite(b.tokens) ? b.tokens : 0),
    0,
  );

  if (windowMinutes === null || !Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    return baseView(account, 'no-window', { tokensInWindow });
  }
  if (resetAtMs === null || windowStartMs === null) {
    return baseView(account, 'no-window', { tokensInWindow });
  }
  if (usedPercent === null || !Number.isFinite(usedPercent)) {
    return baseView(account, 'no-snapshot', { tokensInWindow });
  }
  // 快照已过重置时刻：上游尚未刷新，used% 已无意义（绝不能当成 0%）
  if (nowMs >= resetAtMs) {
    return baseView(account, 'stale-snapshot', { tokensInWindow, usedPercent });
  }
  if (snapshotMs === null) {
    return baseView(account, 'no-snapshot', { tokensInWindow });
  }
  // 窗口起点早于可查历史（如 free 计划的 30 天窗口）⇒ token 会被截断，标定不可信
  if (historyFloorMs !== null && windowStartMs < historyFloorMs) {
    return baseView(account, 'truncated', { tokensInWindow });
  }
  if (snapshotMs <= windowStartMs || nowMs - windowStartMs < MIN_ELAPSED_HOURS * HOUR_MS) {
    return baseView(account, 'window-not-started', { tokensInWindow });
  }
  if (tokensInWindow <= 0) {
    return baseView(account, usedPercent === 0 ? 'quiet' : 'no-usage', { tokensInWindow });
  }
  if (usedPercent <= 0) {
    // 有消耗但上游报 0%：无法标定
    return baseView(account, 'quiet', { tokensInWindow, usedPercent: 0 });
  }

  const band = tokensPerPercentBand(tokensInWindow, usedPercent);
  if (!band) return baseView(account, 'no-usage', { tokensInWindow });

  const rate = trailingTokensPerHour(buckets, nowMs, windowStartMs, windowMinutes);
  if (!rate || rate.tokensPerHour <= 0) {
    return baseView(account, 'rate-unavailable', {
      tokensInWindow,
      tokensPerPercent: band.central,
      tokensPerPercentBand: { min: band.min, max: band.max },
    });
  }

  const history: QuotaHistoryPoint[] = [];
  let cumulative = 0;
  for (const bucket of buckets) {
    if (bucket.ts > snapshotMs) break;
    cumulative += Number.isFinite(bucket.tokens) ? bucket.tokens : 0;
    history.push({
      ts: bucket.ts,
      percent: Math.min(MAX_PERCENT, cumulative / band.central),
      tokens: bucket.tokens,
    });
  }
  if (history.length === 0) {
    return baseView(account, 'no-usage', { tokensInWindow });
  }

  const ratePerHour = rate.tokensPerHour / band.central; // 百分点/小时（仅用于展示）
  const hoursToReset = (resetAtMs - nowMs) / HOUR_MS;
  const { verdict, percentAtReset, percentAtResetBand } = resolveQuotaVerdict({
    usedPercent,
    tokensPerHour: rate.tokensPerHour,
    hoursToReset,
    perPercentCentral: band.central,
    perPercentMin: band.min,
    perPercentMax: band.max,
  });

  const exhaustAtMs =
    ratePerHour > 0 ? nowMs + ((MAX_PERCENT - usedPercent) / ratePerHour) * HOUR_MS : null;

  const last = history[history.length - 1];
  const stopMs = Math.max(Math.min(resetAtMs, exhaustAtMs ?? resetAtMs), last.ts);
  const forecast: QuotaForecastPoint[] = [
    { ts: last.ts, percent: last.percent },
    {
      ts: stopMs,
      percent: Math.min(
        MAX_PERCENT,
        usedPercent + (ratePerHour * (stopMs - nowMs)) / HOUR_MS,
      ),
    },
  ];

  return {
    accountId: account.accountId,
    accountName: account.accountName,
    planType: account.planType,
    state: 'ok',
    verdict,
    calibration: usedPercent >= 5 && history.length >= 3 ? 'ok' : 'coarse',
    usedPercent,
    resetAtMs,
    windowStartMs,
    snapshotMs,
    windowMinutes,
    tokensInWindow,
    tokensPerPercent: band.central,
    tokensPerPercentBand: { min: band.min, max: band.max },
    ratePerHour,
    lookbackHours: rate.lookbackHours,
    rateSpanStartMs: rate.spanStartMs,
    percentAtReset,
    percentAtResetBand,
    exhaustAtMs,
    history,
    forecast,
  };
}

export function buildQuotaProjections(
  accounts: QuotaProjectionAccount[],
  nowMs: number,
  historyFloorMs: number | null = null,
): QuotaProjectionView[] {
  return accounts.map((account) => buildQuotaProjection(account, nowMs, historyFloorMs));
}

export function summarizeVerdicts(views: QuotaProjectionView[]): Record<QuotaVerdict, number> {
  const summary: Record<QuotaVerdict, number> = {
    enough: 0,
    tight: 0,
    'not-enough': 0,
    uncertain: 0,
    unknown: 0,
  };
  for (const view of views) summary[view.verdict] += 1;
  return summary;
}
