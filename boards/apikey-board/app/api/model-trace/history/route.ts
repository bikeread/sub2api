import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/http';
import { listHistory } from '@/lib/modeltrace/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const raw = request.nextUrl.searchParams.get('account_id');
    const accountId = raw ? Number(raw) : undefined;
    if (raw && (!Number.isInteger(accountId) || (accountId ?? 0) <= 0)) {
      return jsonError(400, 'account_id 无效');
    }
    const method = request.nextUrl.searchParams.get('method');
    if (method && method !== 'fingerprint' && method !== 'prompt')
      return jsonError(400, '检测方式无效');
    const entries = (await listHistory(accountId)).filter(
      (entry) => !method || (entry.method ?? 'fingerprint') === method,
    );
    return jsonOk({ entries: entries.slice(0, 50) });
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
