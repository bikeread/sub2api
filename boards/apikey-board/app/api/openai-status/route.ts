import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/http';
import type { OpenAIStatusPayload } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUS_URL = 'https://status.openai.com/api/v2/status.json';
const CACHE_TTL_MS = 60_000;

let cached: { payload: OpenAIStatusPayload; expiresAt: number } | null = null;

async function fetchOpenAIStatus(): Promise<OpenAIStatusPayload> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.payload;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const resp = await fetch(STATUS_URL, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!resp.ok) throw new Error(`status endpoint returned ${resp.status}`);
      const body = (await resp.json()) as {
        status?: { indicator?: string; description?: string };
      };
      const payload: OpenAIStatusPayload = {
        indicator: body.status?.indicator ?? 'unknown',
        description: body.status?.description ?? 'Unknown',
        fetchedAt: new Date().toISOString(),
      };
      cached = { payload, expiresAt: Date.now() + CACHE_TTL_MS };
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    const payload: OpenAIStatusPayload = {
      indicator: 'unknown',
      description: 'Unavailable',
      fetchedAt: new Date().toISOString(),
    };
    cached = { payload, expiresAt: Date.now() + CACHE_TTL_MS };
    return payload;
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return jsonOk(await fetchOpenAIStatus());
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
