import { describe, expect, it } from 'vitest';
import {
  createDetectionBatch,
  DEFAULT_PROMPT,
  parseDetectionRequest,
} from './request';

describe('detection requests', () => {
  it('keeps old requests on the fingerprint path', () => {
    expect(parseDetectionRequest({ account_id: 7 })).toEqual({
      account_id: 7,
      method: 'fingerprint',
      model: undefined,
    });
  });
  it('preserves the entire candy question, table and edited whitespace', () => {
    expect(DEFAULT_PROMPT).toContain('不同的形状靠手感可以分辨');
    expect(DEFAULT_PROMPT).toContain(
      '| 圆形   | 7   | 9   | 8   |\n| 五角星形 | 7   | 6   | 4   |',
    );
    const edited = `\n${DEFAULT_PROMPT}\n请说明理由。  `;
    expect(
      parseDetectionRequest({
        account_id: 1,
        method: 'prompt',
        model: ' outside-bank ',
        prompt: edited,
      }).prompt,
    ).toBe(edited);
  });
  it.each([
    { account_id: 0 },
    { account_id: 1, method: 'unknown' },
    { account_id: 1, model: 3 },
    { account_id: 1, method: 'prompt', prompt: DEFAULT_PROMPT },
    { account_id: 1, method: 'prompt', model: 'custom', prompt: '  ' },
  ])('rejects invalid inputs before executing: %j', (input) => {
    expect(() => parseDetectionRequest(input)).toThrow();
  });
  it('snapshots all batch models and the prompt before execution', () => {
    const models = { 1: 'model-a', 2: 'model-b' };
    const batch = createDetectionBatch(
      [1, 2],
      models,
      'prompt',
      DEFAULT_PROMPT,
    );
    models[2] = 'changed';
    expect(batch[1]).toEqual({
      account_id: 2,
      method: 'prompt',
      model: 'model-b',
      prompt: DEFAULT_PROMPT,
    });
    expect(() =>
      createDetectionBatch([1, 3], models, 'prompt', DEFAULT_PROMPT),
    ).toThrow('目标模型');
  });
});

it('snapshots reasoning effort per account and omits model-default values', () => {
  const efforts = { 1: 'high', 2: '' };
  const batch = createDetectionBatch(
    [1, 2],
    { 1: 'gpt-5.5', 2: 'gpt-5.5' },
    'prompt',
    DEFAULT_PROMPT,
    efforts,
  );
  efforts[1] = 'low';
  expect(batch[0].reasoning_effort).toBe('high');
  expect(batch[1]).not.toHaveProperty('reasoning_effort');
  expect(() =>
    parseDetectionRequest({ account_id: 1, reasoning_effort: 42 }),
  ).toThrow('思维强度无效');
});

it('accepts an advertised future effort for validation against the account catalog', () => {
  expect(
    parseDetectionRequest({ account_id: 1, reasoning_effort: 'ultra' })
      .reasoning_effort,
  ).toBe('ultra');
  expect(
    parseDetectionRequest({ account_id: 1, reasoning_effort: 'future-effort' })
      .reasoning_effort,
  ).toBe('future-effort');
});
