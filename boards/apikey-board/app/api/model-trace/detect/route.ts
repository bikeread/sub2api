import type { NextRequest } from 'next/server';

import { extractBearerToken, requireAdmin } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/http';
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
    const body = (await request.json().catch(() => ({}))) as {
      account_id?: number;
      model?: string;
    };
    const accountId = Number(body.account_id);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return jsonError(400, 'account_id 无效');
    }
    // 留空则自动选账号能力清单里最强的可归因模型
    const model = (body.model ?? '').trim() || undefined;
    const accounts = await listOpenAIAccounts(token);
    const account = accounts.find((item) => item.id === accountId);
    if (!account) {
      return jsonError(404, `账号 ${accountId} 不存在或不是 OpenAI 账号`);
    }
    const outcome = await detectAccount(token, account, model);    return jsonOk(outcome);
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
