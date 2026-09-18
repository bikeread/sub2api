import { describe, expect, it } from 'vitest';

import {
  buildQuotaProjection,
  resolveQuotaVerdict,
  startOfHourMs,
  summarizeVerdicts,
  tokensPerPercentBand,
  trailingTokensPerHour,
} from '@/lib/quota-projection';
import type { QuotaProjectionAccount, QuotaProjectionBucket } from '@/lib/types';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-18T09:26:00.000Z');
const WINDOW_MINUTES = 7 * 24 * 60; // 10080
const RESET_AT = NOW + 140 * HOUR;
const WINDOW_START = RESET_AT - WINDOW_MINUTES * 60_000;
const SNAPSHOT_AT = NOW - 2 * 60_000;

function account(overrides: Partial<QuotaProjectionAccount> = {}): QuotaProjectionAccount {
  return {
    accountId: 2,
    accountName: 'RW-pro',
    planType: 'pro',
    usedPercent: 49,
    resetAt: new Date(RESET_AT).toISOString(),
    windowStartAt: new Date(WINDOW_START).toISOString(),
    snapshotAt: new Date(SNAPSHOT_AT).toISOString(),
    windowMinutes: WINDOW_MINUTES,
    buckets: [],
    ...overrides,
  };
}

function bucket(ts: number, tokens: number): QuotaProjectionBucket {
  return { ts, label: '', tokens };
}

describe('startOfHourMs', () => {
  it('floors to the hour', () => {
    expect(startOfHourMs(Date.parse('2026-09-18T09:26:30.000Z'))).toBe(
      Date.parse('2026-09-18T09:00:00.000Z'),
    );
  });
});

describe('tokensPerPercentBand', () => {
  it('integer percent yields a ±0.5 band', () => {
    const band = tokensPerPercentBand(35_795_894, 49);
    expect(band?.quantum).toBe(1);
    // 中枢 = tokens / 49
    expect(Math.round(band!.central)).toBeCloseTo(730_528, -1);
    // 悲观（分母更大 ⇒ 每 1% 更少 token）在 min，乐观在 max
    expect(band!.min).toBeLessThan(band!.central);
    expect(band!.max).toBeGreaterThan(band!.central);
  });

  it('decimal percent narrows the band', () => {
    expect(tokensPerPercentBand(1_000, 12.5)?.quantum).toBe(0.1);
  });

  it('returns null without tokens or percent', () => {
    expect(tokensPerPercentBand(0, 49)).toBeNull();
    expect(tokensPerPercentBand(100, 0)).toBeNull();
  });
});

describe('trailingTokensPerHour', () => {
  it('caps the lookback at 24h and divides by the exact span', () => {
    const buckets = [bucket(startOfHourMs(NOW), 1_000_000), bucket(startOfHourMs(NOW) - 20 * HOUR, 23_000_000)];
    const rate = trailingTokensPerHour(buckets, NOW, WINDOW_START, WINDOW_MINUTES);
    expect(rate?.lookbackHours).toBe(24);
    expect(rate?.spanStartMs).toBe(startOfHourMs(NOW) - 23 * HOUR);
    // 24M over 23.43h
    expect(rate!.tokensPerHour).toBeGreaterThan(1_000_000);
    expect(rate!.tokensPerHour).toBeLessThan(1_100_000);
  });

  it('clamps the lookback to the elapsed window time', () => {
    const rate = trailingTokensPerHour([], NOW, NOW - 3 * HOUR, WINDOW_MINUTES);
    expect(rate?.lookbackHours).toBe(3);
  });

  it('ignores buckets outside the lookback span', () => {
    const rate = trailingTokensPerHour(
      [bucket(startOfHourMs(NOW) - 40 * HOUR, 99_000_000)],
      NOW,
      WINDOW_START,
      WINDOW_MINUTES,
    );
    expect(rate?.tokensPerHour).toBe(0);
  });
});

describe('resolveQuotaVerdict', () => {
  // 速率是 token/小时，perPercent* 是"每 1% 对应多少 token"
  const base = {
    usedPercent: 10,
    tokensPerHour: 10,
    hoursToReset: 10,
    perPercentCentral: 1000,
    perPercentMin: 990,
    perPercentMax: 1010,
  };

  it('flags an already exhausted window', () => {
    expect(resolveQuotaVerdict({ ...base, usedPercent: 100 }).verdict).toBe('not-enough');
  });

  it('flags not-enough when even the optimistic case crosses 100%', () => {
    expect(resolveQuotaVerdict({ ...base, tokensPerHour: 10_000 }).verdict).toBe('not-enough');
  });

  it('flags uncertain when the quantisation band straddles 100%', () => {
    // 悲观刚过 100、乐观没过 ⇒ 不确定
    expect(
      resolveQuotaVerdict({
        ...base,
        usedPercent: 99.5,
        tokensPerHour: 99,
        perPercentCentral: 3000,
        perPercentMin: 990,
        perPercentMax: 9900,
      }).verdict,
    ).toBe('uncertain');
  });

  it('flags tight just below the wall', () => {
    // 悲观 = 10 + 8000/1000*10 = 90
    expect(resolveQuotaVerdict({ ...base, tokensPerHour: 8000 }).verdict).toBe('tight');
  });

  it('flags enough for a slow burn', () => {
    expect(resolveQuotaVerdict({ ...base, tokensPerHour: 1 }).verdict).toBe('enough');
  });
});

describe('buildQuotaProjection', () => {
  const burst = [
    // 窗口前半段安静，最后两小时爆发——实测就是这种形状
    bucket(startOfHourMs(NOW) - 24 * HOUR, 500_000),
    bucket(startOfHourMs(NOW) - 2 * HOUR, 8_000_000),
    bucket(startOfHourMs(NOW) - 1 * HOUR, 27_295_894),
  ];

  it('projects a burst as not-enough and keeps the history endpoint at the snapshot percent', () => {
    const view = buildQuotaProjection(account({ buckets: burst }), NOW, null);
    expect(view.state).toBe('ok');
    expect(view.verdict).toBe('not-enough');
    expect(view.tokensInWindow).toBeCloseTo(35_795_894, 0);
    expect(Math.round(view.tokensPerPercent!)).toBeCloseTo(730_528, -2);
    // 历史序列终点按定义等于上游的 used%
    const last = view.history[view.history.length - 1];
    expect(last.percent).toBeLessThanOrEqual(49.01);
    expect(last.percent).toBeGreaterThan(48.9);
    // 预测段从历史终点接出去，且不越过 100%
    expect(view.forecast[0].ts).toBe(last.ts);
    expect(view.forecast[0].percent).toBeCloseTo(last.percent, 5);
    expect(view.forecast[1].percent).toBeLessThanOrEqual(100);
    expect(view.calibration).toBe('ok');
  });

  it('reports enough for a slow burn over a long horizon', () => {
    const view = buildQuotaProjection(
      account({ usedPercent: 5, buckets: [bucket(startOfHourMs(NOW) - HOUR, 3_000_000)] }),
      NOW,
      null,
    );
    expect(view.state).toBe('ok');
    expect(view.verdict).toBe('enough');
  });

  it('never treats a snapshot past the reset as 0%', () => {
    const view = buildQuotaProjection(
      account({ resetAt: new Date(NOW - HOUR).toISOString(), buckets: burst }),
      NOW,
      null,
    );
    expect(view.state).toBe('stale-snapshot');
    expect(view.usedPercent).toBe(49);
    expect(view.history).toHaveLength(0);
  });

  it('degrades when the window length is missing', () => {
    expect(buildQuotaProjection(account({ windowMinutes: 0 }), NOW, null).state).toBe('no-window');
    expect(buildQuotaProjection(account({ windowMinutes: null }), NOW, null).state).toBe(
      'no-window',
    );
  });

  it('marks a window that predates available history as truncated', () => {
    // free 计划上报 30 天窗口：窗口起点远早于 9 天可查历史
    const windowMinutes = 30 * 24 * 60;
    const view = buildQuotaProjection(
      account({
        windowMinutes,
        windowStartAt: new Date(RESET_AT - windowMinutes * 60_000).toISOString(),
        buckets: burst,
      }),
      NOW,
      NOW - 9 * 24 * HOUR,
    );
    expect(view.state).toBe('truncated');
  });

  it('marks a freshly reset window as quiet', () => {
    const view = buildQuotaProjection(
      account({ usedPercent: 0, buckets: [] }),
      NOW,
      null,
    );
    expect(view.state).toBe('quiet');
    expect(view.verdict).toBe('unknown');
  });

  it('refuses to project without recent consumption', () => {
    const view = buildQuotaProjection(
      account({ buckets: [bucket(startOfHourMs(NOW) - 30 * HOUR, 35_795_894)] }),
      NOW,
      null,
    );
    expect(view.state).toBe('rate-unavailable');
    expect(view.tokensPerPercent).not.toBeNull();
  });
});

describe('summarizeVerdicts', () => {
  it('counts every verdict bucket', () => {
    const views = [
      buildQuotaProjection(account({ buckets: [bucket(startOfHourMs(NOW) - HOUR, 27_000_000)] }), NOW, null),
      buildQuotaProjection(account({ usedPercent: null }), NOW, null),
    ];
    const summary = summarizeVerdicts(views);
    expect(summary['not-enough'] + summary.unknown).toBe(2);
    expect(summary.enough).toBe(0);
  });
});
