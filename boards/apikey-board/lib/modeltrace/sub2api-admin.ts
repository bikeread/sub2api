// Minimal sub2api admin client for model-trace provisioning.
// 直接复用调用方（当前管理员）的 JWT，不额外存储任何凭证。

type Envelope<T> = { code?: number; message?: string; data?: T };

export interface AdminAccount {
  id: number;
  name: string;
  platform: string;
  type: string;
  status: string;
  schedulable?: boolean;
}

function baseUrl(): string {
  const value = process.env.SUB2API_BASE_URL;
  if (!value) throw new Error('SUB2API_BASE_URL is not configured');
  return value.replace(/\/+$/, '');
}

async function adminFetch<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  const payload = (await response.json()) as Envelope<T>;
  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
    throw new Error(
      `sub2api ${path} 失败: ${payload.message ?? `HTTP ${response.status}`}`,
    );
  }
  return payload.data as T;
}

export async function listOpenAIAccounts(token: string): Promise<AdminAccount[]> {
  const data = await adminFetch<{ items?: AdminAccount[] }>(
    token,
    '/api/v1/admin/accounts?platform=openai&page=1&page_size=200&lite=true',
  );
  return Array.isArray(data?.items) ? data.items : [];
}

export async function getAccountGroupIds(
  token: string,
  accountId: number,
): Promise<number[]> {
  const data = await adminFetch<{
    account_groups?: { group_id?: number; group?: { id?: number } }[];
    groups?: { id?: number }[];
  }>(token, `/api/v1/admin/accounts/${accountId}`);
  const ids = new Set<number>();
  for (const entry of data?.account_groups ?? []) {
    const id = entry.group_id ?? entry.group?.id;
    if (id && id > 0) ids.add(id);
  }
  for (const group of data?.groups ?? []) {
    if (group.id && group.id > 0) ids.add(group.id);
  }
  return [...ids];
}

/** 账号上游能力清单（extra.upstream_model_metadata.models 的 key 列表）。 */
export async function getAccountSupportedModels(
  token: string,
  accountId: number,
): Promise<string[]> {
  const data = await adminFetch<{
    extra?: { upstream_model_metadata?: { models?: Record<string, unknown> } };
  }>(token, `/api/v1/admin/accounts/${accountId}`);
  const models = data?.extra?.upstream_model_metadata?.models;
  return models && typeof models === 'object' ? Object.keys(models) : [];
}

export async function createProbeGroup(
  token: string,
  name: string,
): Promise<number> {
  const data = await adminFetch<{ id?: number }>(token, '/api/v1/admin/groups', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description: 'managed-by-modeltrace：降智巡检专用单账号分组，勿手工编辑',
      platform: 'openai',
      rate_multiplier: 1,
    }),
  });
  if (!data?.id) throw new Error('创建巡检分组失败：响应缺少 id');
  return data.id;
}

export async function setAccountGroupIds(
  token: string,
  accountId: number,
  groupIds: number[],
): Promise<void> {
  await adminFetch(token, `/api/v1/admin/accounts/${accountId}`, {
    method: 'PUT',
    body: JSON.stringify({ group_ids: groupIds }),
  });
}

/** 部分更新账号分组（指针字段，未提供的保持不变）。 */
export async function updateAccount(
  token: string,
  accountId: number,
  payload: { group_ids?: number[] },
): Promise<void> {
  await adminFetch(token, `/api/v1/admin/accounts/${accountId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/**
 * 开关账号调度。注意：单个账号 PUT 的 UpdateAccountInput 不接受 schedulable
 * 字段（静默忽略），必须走这个专用端点。
 */
export async function setAccountSchedulable(
  token: string,
  accountId: number,
  schedulable: boolean,
): Promise<void> {
  await adminFetch(token, `/api/v1/admin/accounts/${accountId}/schedulable`, {
    method: 'POST',
    body: JSON.stringify({ schedulable }),
  });
}

export async function createProbeKey(
  token: string,
  name: string,
  groupId: number,
): Promise<string> {
  const data = await adminFetch<{ id?: number; key?: string }>(
    token,
    '/api/v1/keys',
    {
      method: 'POST',
      body: JSON.stringify({ name, group_id: groupId }),
    },
  );
  if (!data?.key) throw new Error('创建巡检 key 失败：响应缺少 key');
  return data.key;
}

/** 调网关 chat completions，返回正文文本。 */
export async function runChatCompletion(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<string> {
  const response = await fetch(`${baseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      max_tokens: 4096,
    }),
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    const upstream = payload?.error?.message ?? '';
    const hint =
      response.status === 503
        ? '（网关在该账号的巡检分组内选不出可调度账号：账号可能正处于冷却/过载窗口，稍后恢复调度再测）'
        : '';
    throw new Error(
      `网关请求失败 HTTP ${response.status}: ${upstream}${hint}`,
    );
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content) {
    throw new Error('网关响应缺少文本内容');
  }
  return content;
}
