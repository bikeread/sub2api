import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROMPT } from './request';

vi.mock('./sub2api-admin', () => ({
  getAccountGroupIds: vi.fn(),
  getAccountModelCatalog: vi.fn(),
  runChatCompletion: vi.fn(),
  runChatCompletionResult: vi.fn(),
  setAccountSchedulable: vi.fn(),
  updateAccount: vi.fn(),
}));
vi.mock('./provision', () => ({ ensureProbeRoute: vi.fn() }));
vi.mock('./store', () => ({ appendHistory: vi.fn() }));
vi.mock('./fingerprint', () => ({ analyzeOutputs: vi.fn() }));
import * as admin from './sub2api-admin';
import { ensureProbeRoute } from './provision';
import { appendHistory } from './store';
import { analyzeOutputs } from './fingerprint';
import { detectAccount } from './detect';

const account = {
  id: 41,
  name: 'Test',
  type: 'oauth',
  platform: 'openai',
  status: 'active',
  schedulable: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(admin.getAccountGroupIds).mockResolvedValue([1, 2]);
  vi.mocked(admin.getAccountModelCatalog).mockResolvedValue({
    source: 'account',
    models: [
      { id: 'custom-model', reasoningEfforts: ['high', 'ultra'] },
      { id: 'gpt-5.5', reasoningEfforts: ['high', 'xhigh'] },
    ],
  });
  vi.mocked(ensureProbeRoute).mockResolvedValue({
    accountId: 41,
    accountName: 'Test',
    groupId: 99,
    apiKey: 'fixture-key',
    createdAt: '',
  });
  vi.mocked(admin.runChatCompletionResult).mockResolvedValue({
    text: '模型回答\n完整文本',
    finishReason: 'stop',
  });
});

describe('account detection lifecycle', () => {
  it('sends one unmodified prompt outside the fingerprint bank, preserves output and restores membership', async () => {
    const outcome = await detectAccount(
      'fixture-token',
      account,
      'custom-model',
      'prompt',
      DEFAULT_PROMPT,
    );
    expect(admin.runChatCompletionResult).toHaveBeenCalledExactlyOnceWith(
      'fixture-key',
      'custom-model',
      DEFAULT_PROMPT,
      undefined,
    );
    expect(analyzeOutputs).not.toHaveBeenCalled();
    expect(outcome.entry).toMatchObject({
      method: 'prompt',
      prompt: DEFAULT_PROMPT,
      output: '模型回答\n完整文本',
      finishReason: 'stop',
      model: 'custom-model',
    });
    expect(outcome.entry).not.toHaveProperty('verdict');
    expect(outcome.entry).not.toHaveProperty('prediction');
    expect(outcome.entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(admin.updateAccount).toHaveBeenNthCalledWith(
      1,
      'fixture-token',
      41,
      { group_ids: [99] },
    );
    expect(admin.setAccountSchedulable).toHaveBeenNthCalledWith(
      1,
      'fixture-token',
      41,
      true,
    );
    expect(admin.setAccountSchedulable).toHaveBeenNthCalledWith(
      2,
      'fixture-token',
      41,
      false,
    );
    expect(admin.updateAccount).toHaveBeenLastCalledWith('fixture-token', 41, {
      group_ids: [1, 2],
    });
    expect(appendHistory).toHaveBeenCalledWith(outcome.entry);
  });
  it('retains long and truncated outputs without judging them', async () => {
    const text = '<script>alert(1)</script>\n'.repeat(1000);
    vi.mocked(admin.runChatCompletionResult).mockResolvedValue({
      text,
      finishReason: 'length',
    });
    const outcome = await detectAccount(
      'token',
      account,
      'custom-model',
      'prompt',
      'test',
    );
    expect(outcome.entry).toMatchObject({
      output: text,
      finishReason: 'length',
    });
  });
  it('does not retry prompt failures and releases the lock for a manual retry', async () => {
    vi.mocked(admin.runChatCompletionResult).mockRejectedValueOnce(
      new Error('HTTP 503'),
    );
    await expect(
      detectAccount('token', account, 'custom-model', 'prompt', 'test'),
    ).rejects.toThrow('503');
    expect(admin.runChatCompletionResult).toHaveBeenCalledTimes(1);
    expect(admin.updateAccount).toHaveBeenLastCalledWith('token', 41, {
      group_ids: [1, 2],
    });
    expect(appendHistory).not.toHaveBeenCalled();
    await expect(
      detectAccount('token', account, 'custom-model', 'prompt', 'test'),
    ).resolves.toBeDefined();
  });
  it.each(['provision', 'isolate', 'enable'])(
    'restores when preparation fails at %s',
    async (stage) => {
      if (stage === 'provision')
        vi.mocked(ensureProbeRoute).mockRejectedValueOnce(
          new Error('prepare failed'),
        );
      if (stage === 'isolate')
        vi.mocked(admin.updateAccount).mockRejectedValueOnce(
          new Error('prepare failed'),
        );
      if (stage === 'enable')
        vi.mocked(admin.setAccountSchedulable).mockRejectedValueOnce(
          new Error('prepare failed'),
        );
      await expect(
        detectAccount('token', account, 'custom-model', 'prompt', 'test'),
      ).rejects.toThrow('prepare failed');
      expect(admin.setAccountSchedulable).toHaveBeenLastCalledWith(
        'token',
        41,
        false,
      );
      expect(admin.updateAccount).toHaveBeenLastCalledWith('token', 41, {
        group_ids: [1, 2],
      });
      expect(admin.runChatCompletionResult).not.toHaveBeenCalled();
    },
  );
  it('does not restore production membership if scheduling cannot be disabled', async () => {
    vi.mocked(admin.setAccountSchedulable)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disable failed'));
    await expect(
      detectAccount('token', account, 'custom-model', 'prompt', 'test'),
    ).rejects.toThrow('恢复失败：无法关闭账号调度');
    expect(admin.updateAccount).toHaveBeenCalledTimes(1);
    expect(appendHistory).not.toHaveBeenCalled();
  });
  it('reports membership recovery failure instead of a successful result', async () => {
    vi.mocked(admin.updateAccount)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('restore groups failed'));
    await expect(
      detectAccount('token', account, 'custom-model', 'prompt', 'test'),
    ).rejects.toThrow('原分组未恢复');
    expect(appendHistory).not.toHaveBeenCalled();
  });
  it('rejects concurrent detections of the same account across both modes', async () => {
    let release!: (value: { text: string; finishReason: string }) => void;
    vi.mocked(admin.runChatCompletionResult).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = detectAccount(
      'token',
      account,
      'custom-model',
      'prompt',
      'test',
    );
    await vi.waitFor(() =>
      expect(admin.runChatCompletionResult).toHaveBeenCalledTimes(1),
    );
    try {
      await expect(detectAccount('token', account)).rejects.toMatchObject({
        status: 409,
      });
    } finally {
      release({ text: 'done', finishReason: 'stop' });
    }
    await first;
  });
  it('validates before provisioning and leaves active scheduling alone', async () => {
    await expect(
      detectAccount('token', account, '', 'prompt', 'test'),
    ).rejects.toThrow('目标模型');
    expect(ensureProbeRoute).not.toHaveBeenCalled();
    await detectAccount(
      'token',
      { ...account, schedulable: true },
      'custom-model',
      'prompt',
      'test',
    );
    expect(admin.setAccountSchedulable).not.toHaveBeenCalled();
    expect(admin.updateAccount).not.toHaveBeenCalled();
  });
  it.each([undefined, 'xhigh'] as const)(
    'keeps three fingerprint challenges and persists requested effort %s',
    async (effort) => {
      vi.mocked(admin.runChatCompletion).mockResolvedValue('1, 2, 3');
      vi.mocked(analyzeOutputs).mockReturnValue({
        prediction: 'gpt-5.5',
        probability: 0.9,
        usedOutputs: 3,
        results: [
          { model: 'gpt-5.5', displayName: 'GPT 5.5', probability: 0.9 },
        ],
        diagnostics: [
          { index: 0, parsedNumbers: 200, minimumNumbers: 180, accepted: true },
        ],
        familyProbability: 0.98,
      } as ReturnType<typeof analyzeOutputs>);
      const outcome = await detectAccount(
        'token',
        account,
        undefined,
        'fingerprint',
        undefined,
        effort,
      );
      expect(admin.runChatCompletion).toHaveBeenCalledTimes(3);
      expect(
        vi
          .mocked(admin.runChatCompletion)
          .mock.calls.every((call) => call[3] === effort),
      ).toBe(true);
      expect(outcome.entry.reasoningEffort).toBe(effort);
      expect(admin.runChatCompletionResult).not.toHaveBeenCalled();
      expect(outcome.entry).toMatchObject({
        method: 'fingerprint',
        verdict: 'ok',
        model: 'gpt-5.5',
        usedOutputs: 3,
      });
      expect(outcome).toHaveProperty('attribution');
      expect(outcome.entry).toHaveProperty('attribution.diagnostics');
    },
  );
});

it('forwards and records requested reasoning effort for manual detection', async () => {
  const result = await detectAccount(
    'token',
    account,
    'custom-model',
    'prompt',
    'test',
    'high',
  );
  expect(admin.runChatCompletionResult).toHaveBeenCalledWith(
    'fixture-key',
    'custom-model',
    'test',
    'high',
  );
  expect(result.entry).toHaveProperty('reasoningEffort', 'high');
  expect(appendHistory).toHaveBeenCalledWith(
    expect.objectContaining({ reasoningEffort: 'high' }),
  );
});

it('rejects a known unsupported reasoning effort before changing account routing', async () => {
  const limited = {
    ...account,
    extra: {
      upstream_model_metadata: {
        models: { 'custom-model': { supported_reasoning_levels: ['low'] } },
      },
    },
  };
  vi.mocked(admin.getAccountModelCatalog).mockResolvedValue({
    source: 'account',
    models: [{ id: 'custom-model', reasoningEfforts: ['low'] }],
  });
  await expect(
    detectAccount('token', limited, 'custom-model', 'prompt', 'test', 'high'),
  ).rejects.toThrow('同步数据未列出思维强度');
  expect(ensureProbeRoute).not.toHaveBeenCalled();
});

it('rejects an unsynchronized account before any routing or model request', async () => {
  vi.mocked(admin.getAccountModelCatalog).mockResolvedValue({
    source: 'missing',
    models: [],
  });
  await expect(detectAccount('token', account)).rejects.toThrow('尚无已同步');
  expect(ensureProbeRoute).not.toHaveBeenCalled();
  expect(admin.runChatCompletionResult).not.toHaveBeenCalled();
});
it('validates against the fresh catalog and forwards ultra without changing it', async () => {
  const staleAccount = {
    ...account,
    extra: {
      upstream_model_metadata: {
        models: { 'custom-model': { supported_reasoning_levels: ['high'] } },
      },
    },
  };
  const result = await detectAccount(
    'token',
    staleAccount,
    'custom-model',
    'prompt',
    'test',
    'ultra',
  );
  expect(result.entry.reasoningEffort).toBe('ultra');
  expect(admin.runChatCompletionResult).toHaveBeenCalledWith(
    'fixture-key',
    'custom-model',
    'test',
    'ultra',
  );
});
it('rejects an effort not advertised by the model even when the parameter is a valid string', async () => {
  await expect(
    detectAccount(
      'token',
      account,
      'custom-model',
      'prompt',
      'test',
      'invented',
    ),
  ).rejects.toThrow('同步数据未列出');
  expect(ensureProbeRoute).not.toHaveBeenCalled();
});
