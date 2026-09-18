import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { appConfig } from '@/lib/config';
import {
  getAccountQuotas,
  getLatencyHealth,
  getModelStats,
  getQuotaProjection,
  getRanking,
  getSummary,
} from '@/lib/queries';

function mockPool(rows: Record<string, unknown>[] = []) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { pool: { query } as unknown as Pool, query };
}

/** 每次调用返回不同结果（getQuotaProjection 会发两条查询） */
function mockPoolSequence(rowsPerCall: Record<string, unknown>[][]) {
  const query = vi.fn();
  for (const rows of rowsPerCall) {
    query.mockResolvedValueOnce({ rows });
  }
  return { pool: { query } as unknown as Pool, query };
}

describe('overview roster scope', () => {
  const roster = ['安耐吉-范驰', '安耐吉-张伟'];

  it('filters both active key counts and usage totals in the summary', async () => {
    const { pool, query } = mockPool([{}]);

    const payload = await getSummary(pool, 'today', 9, roster);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];

    expect(sql).toContain('ak.name = ANY($3::text[])');
    expect(sql).toContain('roster_ak.name = ANY($3::text[])');
    expect(params).toEqual([appConfig.timezone, 9, roster]);
    expect(payload.rosterActive).toBe(true);
    expect(payload.rosterTotal).toBe(2);
  });

  it('leaves the overview unfiltered when no roster is configured', async () => {
    const { pool, query } = mockPool([{}]);

    const payload = await getSummary(pool, 'today', 9, []);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];

    expect(sql).not.toContain('roster_ak');
    expect(params).toEqual([appConfig.timezone, 9]);
    expect(payload.rosterActive).toBe(false);
    expect(payload.rosterTotal).toBe(0);
  });

  it('applies the same roster to ranking, latency, and model queries', async () => {
    const { pool, query } = mockPool();

    await getRanking(pool, 'today', 20, 9, roster);
    await getLatencyHealth(pool, 'today', 9, roster);
    await getModelStats(pool, 'today', 10, 9, roster);

    const [rankingSql, rankingParams] = query.mock.calls[0] as [string, unknown[]];
    const [pointsSql, pointsParams] = query.mock.calls[1] as [string, unknown[]];
    const [accountsSql, accountsParams] = query.mock.calls[2] as [string, unknown[]];
    const [errorsSql, errorsParams] = query.mock.calls[3] as [string, unknown[]];
    const [modelsSql, modelsParams] = query.mock.calls[4] as [string, unknown[]];
    expect(rankingSql).toContain('roster_ak.name = ANY($4::text[])');
    expect(pointsSql).toContain('roster_ak.name = ANY($3::text[])');
    expect(accountsSql).toContain('roster_ak.name = ANY($3::text[])');
    expect(errorsSql).not.toContain('roster_ak');
    expect(errorsSql).toContain("date_trunc('hour', oe.created_at AT TIME ZONE $1)");
    expect(modelsSql).toContain('roster_ak.name = ANY($4::text[])');
    expect(rankingParams).toEqual([appConfig.timezone, 20, 9, roster]);
    expect(pointsParams).toEqual([appConfig.timezone, 9, roster]);
    expect(accountsParams).toEqual([appConfig.timezone, 9, roster]);
    expect(errorsParams).toEqual([appConfig.timezone, 9]);
    expect(modelsParams).toEqual([appConfig.timezone, 10, 9, roster]);
  });

  it('omits the group filter from error rows when no group is selected', async () => {
    const { pool, query } = mockPool();

    await getLatencyHealth(pool, 'today');

    const [errorsSql, errorsParams] = query.mock.calls[2] as [string, unknown[]];
    expect(errorsSql).not.toContain('oe.group_id');
    expect(errorsParams).toEqual([appConfig.timezone]);
  });
});

describe('account quota pool', () => {
  const quotaRow = {
    account_id: 2,
    account_name: 'RW-pro',
    status: 'active',
    last_used_at: null,
    plan_type: 'pro',
    subscription_expires_at: '2026-09-22T14:39:08+00:00',
    extra: {
      codex_7d_used_percent: 49,
      codex_7d_reset_at: '2026-09-24T13:47:48+08:00',
      codex_7d_window_minutes: 10080,
      codex_usage_updated_at: '2026-09-18T17:26:28+08:00',
    },
    requests_5h: 0,
    tokens_5h: 0,
    cost_5h: 0,
    requests_7d: 3,
    tokens_7d: 1000,
    cost_7d: 1,
  };

  it('reads plan type and subscription expiry out of credentials (and nothing else)', async () => {
    const { pool, query } = mockPool([quotaRow]);
    const payload = await getAccountQuotas(pool, null);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];

    expect(sql).toContain("a.credentials->>'plan_type'");
    expect(sql).toContain("a.credentials->>'subscription_expires_at'");
    // 绝不能把整份 credentials（含 token）取出来
    expect(sql).not.toContain('a.credentials,');
    expect(params).toEqual([]);

    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0].planType).toBe('pro');
    expect(payload.rows[0].subscriptionExpiresAt).toBe('2026-09-22T14:39:08+00:00');
  });

  it('keeps the group filter bound to $1 after adding columns', async () => {
    const { pool, query } = mockPool([quotaRow]);
    await getAccountQuotas(pool, 9);
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([9]);
  });
});

describe('quota projection', () => {
  const accountRow = {
    id: 2,
    name: 'RW-pro',
    used_percent_raw: '49',
    reset_at_raw: '2026-09-24T13:47:48+08:00',
    window_minutes_raw: '10080',
    snapshot_at_raw: '2026-09-18T17:26:28+08:00',
    plan_type: 'pro',
  };

  it('queries candidate accounts then their hourly buckets, and returns a projection payload', async () => {
    const { pool, query } = mockPoolSequence([
      [accountRow],
      [{ account_id: 2, bucket_at: new Date('2026-09-18T09:00:00Z'), label: '09-18 17:00', tokens: '27000000' }],
    ]);

    const payload = await getQuotaProjection(pool, null);
    const [accountsSql, accountsParams] = query.mock.calls[0] as [string, unknown[]];
    const [bucketsSql, bucketsParams] = query.mock.calls[1] as [string, unknown[]];

    // 候选账号：与额度池同一套谓词（只展示在用账号）
    expect(accountsSql).toContain("a.extra->>'codex_7d_used_percent'");
    expect(accountsSql).toContain("a.status = 'active'");
    expect(accountsSql).toContain('AND a.schedulable');
    expect(accountsParams).toEqual([]);

    // 桶查询：$1 时区、$2 账号、$3 有界回看（命中 account_id+created_at 索引）
    expect(bucketsSql).toContain("date_trunc('hour', ul.created_at AT TIME ZONE $1)");
    expect(bucketsSql).toContain('ul.account_id = ANY($2::bigint[])');
    expect(bucketsSql).toContain('ul.created_at >= $3');
    const [tz, ids, since] = bucketsParams as [string, number[], Date];
    expect(tz).toBe(appConfig.timezone);
    expect(ids).toEqual([2]);
    expect(since).toBeInstanceOf(Date);

    expect(payload.views).toHaveLength(1);
    expect(payload.views[0].accountId).toBe(2);
    expect(payload.views[0].planType).toBe('pro');
    expect(payload.summary).toHaveProperty('enough');
    expect(payload.summary).toHaveProperty('not-enough');
  });

  it('binds the group filter to $1 and skips the bucket query when no account matches', async () => {
    const { pool, query } = mockPoolSequence([[]]);
    const payload = await getQuotaProjection(pool, 9);

    const [accountsSql, accountsParams] = query.mock.calls[0] as [string, unknown[]];
    expect(accountsSql).toContain('account_groups');
    expect(accountsParams).toEqual([9]);
    expect(query.mock.calls).toHaveLength(1); // 没有账号就不查 usage_logs
    expect(payload.views).toEqual([]);
  });
});
