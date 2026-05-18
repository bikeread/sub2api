import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { getTrend } from '@/lib/queries';
import { parseGroupId, parseRange } from '@/lib/range';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const range = parseRange(request.nextUrl.searchParams.get('range'));
    const groupId = parseGroupId(request.nextUrl.searchParams.get('group_id'));
    const payload = await getTrend(getPool(), range, groupId);
    return jsonOk(payload);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return jsonError(401, 'Missing or invalid admin token');
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return jsonError(403, 'Only administrators can access this board');
    }
    return jsonError(500, error instanceof Error ? error.message : 'Unexpected error');
  }
}
