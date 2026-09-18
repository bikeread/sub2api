import type { NextRequest } from 'next/server';

import { extractBearerToken, requireAdmin } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/http';
import { listOpenAIAccounts } from '@/lib/modeltrace/sub2api-admin';
import { getModelCatalog } from '@/lib/modeltrace/options';
import { latestByAccount } from '@/lib/modeltrace/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const token = extractBearerToken(request);
    if (!token) return jsonError(401, 'Missing or invalid admin token');
    const [accounts, latest, latestPrompt] = await Promise.all([
      listOpenAIAccounts(token),
      latestByAccount(),
      latestByAccount('prompt'),
    ]);
    return jsonOk({
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        status: account.status,
        schedulable: account.schedulable ?? false,
        modelCatalog: getModelCatalog(account.extra),
        last: latest.get(account.id) ?? null,
        lastPrompt: latestPrompt.get(account.id) ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return jsonError(401, 'Missing or invalid admin token');
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return jsonError(403, 'Only administrators can access this board');
    }
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Unexpected error',
    );
  }
}
