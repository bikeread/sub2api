import { isReasoningEffort, type ReasoningEffort } from './options';

export type DetectionMethod = 'fingerprint' | 'prompt';

export const DEFAULT_PROMPT = `在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形，不同的形状靠手感可以分辨）。现已知不同口味的糖和不同形状的数量统计如下表。参赛者需要在活动前决定摸出的糖果数目，那么，最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖？（同时手中有圆形苹果味匹配五角星桃子味糖果，或者有圆形桃子味匹配五角星苹果味糖果都满足要求）

|      | 苹果味 | 桃子味 | 西瓜味 |
| ---- | --- | --- | --- |
| 圆形   | 7   | 9   | 8   |
| 五角星形 | 7   | 6   | 4   |`;

export interface DetectionRequest {
  account_id: number;
  model?: string;
  method: DetectionMethod;
  prompt?: string;
  reasoning_effort?: ReasoningEffort;
}

export class DetectionError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export function parseDetectionRequest(value: unknown): DetectionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DetectionError('请求格式无效');
  const body = value as Record<string, unknown>;
  const accountId = Number(body.account_id);
  if (!Number.isSafeInteger(accountId) || accountId <= 0)
    throw new DetectionError('account_id 无效');
  const method = body.method ?? 'fingerprint';
  if (method !== 'fingerprint' && method !== 'prompt')
    throw new DetectionError('检测方式无效');
  if (body.model !== undefined && typeof body.model !== 'string')
    throw new DetectionError('model 必须为文本');
  const model = (body.model as string | undefined)?.trim() || undefined;
  const effort = body.reasoning_effort;
  if (effort !== undefined && effort !== '' && !isReasoningEffort(effort)) {
    throw new DetectionError('思维强度无效');
  }
  if (method === 'prompt') {
    if (!model) throw new DetectionError('提示词检测请选择目标模型');
    if (typeof body.prompt !== 'string' || !body.prompt.trim())
      throw new DetectionError('请输入检测提示词');
  }
  return {
    account_id: accountId,
    method,
    model,
    ...(isReasoningEffort(effort) ? { reasoning_effort: effort } : {}),
    ...(method === 'prompt' ? { prompt: body.prompt as string } : {}),
  };
}

/** Snapshot the entire batch before the first request; later edits cannot alter it. */
export function createDetectionBatch(
  ids: number[],
  models: Record<number, string>,
  method: DetectionMethod,
  prompt: string,
  efforts: Record<number, string> = {},
): DetectionRequest[] {
  return ids.map((id) =>
    parseDetectionRequest({
      account_id: id,
      model: models[id] || '',
      reasoning_effort: efforts[id],
      method,
      prompt,
    }),
  );
}
