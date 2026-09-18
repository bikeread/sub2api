import type { NextRequest } from 'next/server';

import { extractBearerToken, requireAdmin } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/http';
import {
  DetectionError,
  parseDetectionRequest,
} from '@/lib/modeltrace/request';
import { detectAccount } from '@/lib/modeltrace/detect';
import { listOpenAIAccounts } from '@/lib/modeltrace/sub2api-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// 3 条顺序挑战 + 推理模型耗时较长，给足服务端执行时间
export const maxDuration = 600;

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const token = extractBearerToken(request);
    if (!token) return jsonError(401, 'Missing or invalid admin token');
    const body = parseDetectionRequest(await request.json().catch(() => null));
    const accountId = body.account_id;
    const accounts = await listOpenAIAccounts(token);
    const account = accounts.find((item) => item.id === accountId);
    if (!account) {
      return jsonError(404, `账号 ${accountId} 不存在或不是 OpenAI 账号`);
    }
    const outcome = await detectAccount(
      token,
      account,
      body.model,
      body.method,
      body.prompt,
      body.reasoning_effort,
    );
    return jsonOk(outcome);
  } catch (error) {
    if (error instanceof DetectionError)
      return jsonError(error.status, error.message);
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
