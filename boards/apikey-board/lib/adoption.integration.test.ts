import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADOPTION_DEFAULT_GROUP_NAME, getAdoption } from '@/lib/adoption';
import { readRoster } from '@/lib/roster';

const describeIntegration = process.env.ADOPTION_INTEGRATION === '1' ? describe : describe.skip;

describeIntegration('adoption database integration', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5_000,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('executes every adoption query with the persisted roster', async () => {
    const { rows } = await pool.query(
      `SELECT id
       FROM groups
       WHERE deleted_at IS NULL
         AND status = 'active'
         AND name = $1
       ORDER BY id ASC
       LIMIT 1`,
      [ADOPTION_DEFAULT_GROUP_NAME],
    );
    expect(rows).toHaveLength(1);

    const rosterNames = await readRoster();
    expect(rosterNames.length).toBeGreaterThan(0);

    const payload = await getAdoption(pool, Number(rows[0].id), 'zh', rosterNames);
    expect(payload.rosterActive).toBe(true);
    expect(payload.rosterTotal).toBe(rosterNames.length);
    expect(payload.summary.totalPeople).toBe(rosterNames.length);
    expect(payload.people).toHaveLength(rosterNames.length);
  });
});
