import type { NextRequest } from 'next/server';

import { appConfig } from '@/lib/config';
import type { AdminIdentity, Sub2APISuccessEnvelope } from '@/lib/types';

const AUTH_CACHE_TTL_MS = 15_000;

type CachedIdentity = {
  expiresAt: number;
  identity: AdminIdentity;
};

const authCache = new Map<string, CachedIdentity>();

function getCachedIdentity(token: string): AdminIdentity | null {
  const cached = authCache.get(token);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    authCache.delete(token);
    return null;
  }
  return cached.identity;
}

function setCachedIdentity(token: string, identity: AdminIdentity) {
  authCache.set(token, {
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
    identity,
  });
}

export function extractBearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }

  const fromQuery = request.nextUrl.searchParams.get('token');
  if (fromQuery) {
    return fromQuery.trim();
  }

  return null;
}

export async function requireAdmin(request: NextRequest): Promise<AdminIdentity> {
  const token = extractBearerToken(request);
  if (!token) {
    throw new Error('UNAUTHORIZED');
  }

  const cached = getCachedIdentity(token);
  if (cached) {
    return cached;
  }

  if (!appConfig.sub2apiBaseUrl) {
    throw new Error('SUB2API_BASE_URL is not configured');
  }

  const response = await fetch(`${appConfig.sub2apiBaseUrl}/api/v1/auth/me`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('UNAUTHORIZED');
  }

  const payload =
    (await response.json()) as Sub2APISuccessEnvelope<{
      id: number;
      email: string;
      username?: string;
      role: string;
    }>;

  if (payload?.code !== 0 || payload?.data?.role !== 'admin') {
    throw new Error('FORBIDDEN');
  }

  const identity: AdminIdentity = {
    id: payload.data.id,
    email: payload.data.email,
    username: payload.data.username,
    role: payload.data.role,
  };

  setCachedIdentity(token, identity);
  return identity;
}
