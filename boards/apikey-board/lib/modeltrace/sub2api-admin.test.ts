import { afterEach, expect, it, vi } from 'vitest';
import {
  getAccountModelCatalog,
  runChatCompletionResult,
} from './sub2api-admin';
import { DEFAULT_PROMPT } from './request';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('sends the exact prompt and preserves long output and finish reason', async () => {
  vi.stubEnv('SUB2API_BASE_URL', 'http://fixture.invalid');
  const text = 'long response\n'.repeat(1000);
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: text }, finish_reason: 'length' }],
      }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  expect(
    await runChatCompletionResult(
      'fixture-key',
      'custom-model',
      DEFAULT_PROMPT,
    ),
  ).toEqual({ text, finishReason: 'length' });
  expect(JSON.parse(fetch.mock.calls[0][1].body).messages).toEqual([
    { role: 'user', content: DEFAULT_PROMPT },
  ]);
  expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});

it('reports non-text or missing output instead of creating a completed manual result', async () => {
  vi.stubEnv('SUB2API_BASE_URL', 'http://fixture.invalid');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }))),
  );
  await expect(
    runChatCompletionResult('fixture', 'custom', 'test'),
  ).rejects.toThrow('缺少文本内容');
});

it('forwards explicit reasoning effort and omits it when following the model default', async () => {
  vi.stubEnv('SUB2API_BASE_URL', 'http://fixture.invalid');
  const fetch = vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        }),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  await runChatCompletionResult('fixture', 'gpt-5.5', 'test', 'ultra');
  await runChatCompletionResult('fixture', 'gpt-5.5', 'test');
  expect(JSON.parse(fetch.mock.calls[0][1].body).reasoning_effort).toBe(
    'ultra',
  );
  expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty(
    'reasoning_effort',
  );
});

it('reads fresh synchronized capabilities without exposing account credentials', async () => {
  vi.stubEnv('SUB2API_BASE_URL', 'http://fixture.invalid');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            credentials: { api_key: 'fixture-secret' },
            extra: {
              upstream_model_metadata: {
                models: {
                  'gpt-6-astra': {
                    supported_reasoning_levels: ['high', 'ultra'],
                  },
                },
              },
            },
          },
        }),
      ),
    ),
  );
  const catalog = await getAccountModelCatalog('fixture-token', 1);
  expect(catalog).toEqual({
    source: 'account',
    models: [{ id: 'gpt-6-astra', reasoningEfforts: ['high', 'ultra'] }],
  });
  expect(JSON.stringify(catalog)).not.toContain('fixture-secret');
});
