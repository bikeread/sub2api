import { Pool } from 'pg';

import { requireServerEnv } from '@/lib/config';

declare global {
  // eslint-disable-next-line no-var
  var __apikeyBoardPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!global.__apikeyBoardPool) {
    global.__apikeyBoardPool = new Pool({
      connectionString: requireServerEnv('DATABASE_URL'),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return global.__apikeyBoardPool;
}
