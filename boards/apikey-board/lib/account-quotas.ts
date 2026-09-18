import type { AccountQuotaWindow } from '@/lib/types';

type CodexQuotaWindow = '5h' | '7d';

type CodexSnapshotFieldNames = {
  usedPercent: string;
  resetAt: string;
  resetAfterSeconds: string;
  windowMinutes: string;
};

export type CodexSnapshotExtra = Record<string, unknown> | null | undefined;

const CODEX_SNAPSHOT_FIELDS: Record<CodexQuotaWindow, CodexSnapshotFieldNames> = {
  '5h': {
    usedPercent: 'codex_5h_used_percent',
    resetAt: 'codex_5h_reset_at',
    resetAfterSeconds: 'codex_5h_reset_after_seconds',
    windowMinutes: 'codex_5h_window_minutes',
  },
  '7d': {
    usedPercent: 'codex_7d_used_percent',
    resetAt: 'codex_7d_reset_at',
    resetAfterSeconds: 'codex_7d_reset_after_seconds',
    windowMinutes: 'codex_7d_window_minutes',
  },
};

export function parseExtraNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseExtraDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resetAtFromFallback(extra: Record<string, unknown>, resetAfterKey: string): Date | null {
  const resetAfterSeconds = parseExtraNumber(extra[resetAfterKey]);
  if (resetAfterSeconds === null || resetAfterSeconds <= 0) {
    return null;
  }

  const updatedAt = parseExtraDate(extra.codex_usage_updated_at);
  if (!updatedAt) {
    return null;
  }

  return new Date(updatedAt.getTime() + resetAfterSeconds * 1000);
}

export function parseCodexQuotaWindow(
  extra: CodexSnapshotExtra,
  window: CodexQuotaWindow,
  now: Date = new Date(),
): AccountQuotaWindow {
  if (!extra) {
    return { usedPercent: null, resetAt: null };
  }

  const fields = CODEX_SNAPSHOT_FIELDS[window];
  const rawPercent = parseExtraNumber(extra[fields.usedPercent]);
  // 上游无此窗口时（window_minutes=0，旧后端会写入伪造的 reset_at=快照时刻），
  // 一律视为无数据，避免看板显示"0% 已重置"这类误导信息。
  const windowMinutes = parseExtraNumber(extra[fields.windowMinutes]);
  if (windowMinutes !== null && windowMinutes <= 0) {
    return { usedPercent: null, resetAt: null };
  }
  const resetAt = parseExtraDate(extra[fields.resetAt]) ?? resetAtFromFallback(extra, fields.resetAfterSeconds);

  if (rawPercent === null) {
    return {
      usedPercent: null,
      resetAt: resetAt ? resetAt.toISOString() : null,
    };
  }

  return {
    usedPercent: resetAt && now >= resetAt ? 0 : rawPercent,
    resetAt: resetAt ? resetAt.toISOString() : null,
  };
}

export function hasCodexQuotaSnapshot(extra: CodexSnapshotExtra): boolean {
  if (!extra) return false;
  return (
    parseExtraNumber(extra.codex_5h_used_percent) !== null ||
    parseExtraNumber(extra.codex_7d_used_percent) !== null
  );
}

export interface SubscriptionExpiry {
  /** YYYY-MM-DD；上游缺失时为 null */
  date: string | null;
  /** 日期已早于当前时刻 → 该值可能陈旧（只在查询上游配额时才刷新） */
  stale: boolean;
}

/**
 * accounts.credentials.subscription_expires_at（RFC3339，订阅/套餐到期）解析。
 * 注意与 credentials.expires_at（OAuth token 过期）和 accounts.expires_at（自动暂停）区分。
 * 只展示原值日期，不派生"剩余天数"——该字段可能是陈旧快照。
 */
export function parseSubscriptionExpiry(
  raw: unknown,
  now: Date = new Date(),
): SubscriptionExpiry {
  const parsed = parseExtraDate(raw);
  if (parsed === null) {
    return { date: null, stale: false };
  }
  const text = typeof raw === 'string' ? raw.trim() : '';
  // 保留上游原字符串里的日期部分（含其自带偏移），避免跨时区换算把日期挪一天
  const date = /^\d{4}-\d{2}-\d{2}/.test(text)
    ? text.slice(0, 10)
    : parsed.toISOString().slice(0, 10);
  return { date, stale: parsed.getTime() < now.getTime() };
}

const PLAN_TYPE_LABELS: Record<'zh' | 'en', Record<string, string>> = {
  zh: { free: '免费', pro: 'Pro', prolite: 'Pro Lite', plus: 'Plus', team: 'Team', business: 'Business' },
  en: { free: 'Free', pro: 'Pro', prolite: 'Pro Lite', plus: 'Plus', team: 'Team', business: 'Business' },
};

export function planTypeLabel(planType: string | null, lang: 'zh' | 'en'): string {
  if (!planType) return '—';
  return PLAN_TYPE_LABELS[lang][planType.trim().toLowerCase()] ?? planType;
}
