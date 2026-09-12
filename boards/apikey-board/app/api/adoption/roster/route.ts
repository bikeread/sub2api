import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { parseGroupId } from '@/lib/range';
import { getRoster, readRoster, writeRoster } from '@/lib/roster';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function rosterPath(): string {
  return (
    process.env.ADOPTION_ROSTER_PATH ||
    path.join(process.env.ADOPTION_ROSTER_DIR || '/app/data', 'roster.json')
  );
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const groupId = parseGroupId(request.nextUrl.searchParams.get('group_id'));
    const names = await readRoster();
    const payload = await getRoster(getPool(), groupId, names);
    let updatedAt: string | null = null;

    try {
      updatedAt = (await fs.stat(rosterPath())).mtime.toISOString();
    } catch {
      // An absent roster is a valid, unfiltered state.
    }

    return jsonOk({ ...payload, updatedAt, groupId });
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

export async function PUT(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = (await request.json()) as { names?: unknown };
    if (!body || !Array.isArray(body.names)) {
      return jsonError(400, 'Request body must contain a names array');
    }
    return jsonOk(await writeRoster(body.names));
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
