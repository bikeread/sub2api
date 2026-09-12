import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { appConfig } from '@/lib/config';
import { getLatencyHealth, getModelStats, getRanking, getSummary } from '@/lib/queries';

function mockPool(rows: Record<string, unknown>[] = []) {
  const query = vi.fn().mockResolvedValue({ rows });
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
