import { describe, expect, it } from 'vitest';

import {
  hasCodexQuotaSnapshot,
  parseCodexQuotaWindow,
  parseExtraDate,
  parseExtraNumber,
} from '@/lib/account-quotas';

describe('account quota helpers', () => {
  const now = new Date('2026-05-28T10:00:00Z');

  it('parses numeric and date values from account extra', () => {
    expect(parseExtraNumber(88.5)).toBe(88.5);
    expect(parseExtraNumber('42')).toBe(42);
    expect(parseExtraNumber('bad')).toBeNull();
    expect(parseExtraDate('2026-05-28T12:00:00Z')?.toISOString()).toBe('2026-05-28T12:00:00.000Z');
    expect(parseExtraDate('bad')).toBeNull();
  });

  it('detects Codex quota snapshots', () => {
    expect(hasCodexQuotaSnapshot({ codex_5h_used_percent: 1 })).toBe(true);
    expect(hasCodexQuotaSnapshot({ codex_7d_used_percent: '88' })).toBe(true);
    expect(hasCodexQuotaSnapshot({ codex_usage_updated_at: '2026-05-28T10:00:00Z' })).toBe(false);
  });

  it('prefers explicit reset_at fields', () => {
    const window = parseCodexQuotaWindow(
      {
        codex_5h_used_percent: 72.5,
        codex_5h_reset_at: '2026-05-28T12:30:00Z',
        codex_5h_reset_after_seconds: 30,
        codex_usage_updated_at: '2026-05-28T09:00:00Z',
      },
      '5h',
      now,
    );

    expect(window).toEqual({
      usedPercent: 72.5,
      resetAt: '2026-05-28T12:30:00.000Z',
    });
  });

  it('falls back to reset_after_seconds plus codex_usage_updated_at', () => {
    const window = parseCodexQuotaWindow(
      {
        codex_7d_used_percent: '91',
        codex_7d_reset_after_seconds: 7200,
        codex_usage_updated_at: '2026-05-28T09:00:00Z',
      },
      '7d',
      now,
    );

    expect(window).toEqual({
      usedPercent: 91,
      resetAt: '2026-05-28T11:00:00.000Z',
    });
  });

  it('zeros used percent when the reset window has expired', () => {
    const window = parseCodexQuotaWindow(
      {
        codex_5h_used_percent: 100,
        codex_5h_reset_at: '2026-05-28T09:59:59Z',
      },
      '5h',
      now,
    );

    expect(window).toEqual({
      usedPercent: 0,
      resetAt: '2026-05-28T09:59:59.000Z',
    });
  });

  it('returns null usage when no used percent exists', () => {
    expect(parseCodexQuotaWindow({ codex_5h_reset_at: '2026-05-28T11:00:00Z' }, '5h', now)).toEqual({
      usedPercent: null,
      resetAt: '2026-05-28T11:00:00.000Z',
    });
  });

  it('treats a zero-minute window as absent instead of fabricating a reset time', () => {
    // 生产实测：ChatGPT 账号无 5h secondary 窗口时上游返回 used=0/reset_after=0/window_minutes=0，
    // 旧后端把 reset_at 写成快照时刻，看板因此显示伪造的"已重置"。
    const window = parseCodexQuotaWindow(
      {
        codex_5h_used_percent: 0,
        codex_5h_reset_after_seconds: 0,
        codex_5h_reset_at: '2026-05-28T10:00:00Z',
        codex_5h_window_minutes: 0,
      },
      '5h',
      now,
    );

    expect(window).toEqual({ usedPercent: null, resetAt: null });
  });
});
