import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

let directory: string;
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('reads legacy entries and retrieves recent results independently by method', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'modeltrace-history-test-'));
  vi.stubEnv('MODELTRACE_DATA_DIR', directory);
  vi.resetModules();
  const { appendHistory, latestByAccount, listHistory } = await import(
    './store'
  );
  const legacy = {
    accountId: 1,
    accountName: 'test',
    model: 'gpt-5.5',
    verdict: 'ok' as const,
    reason: 'legacy',
    prediction: 'gpt-5.5',
    probability: 0.9,
    top: [],
    usedOutputs: 3,
    detectedAt: '2026-09-10T00:00:00Z',
  };
  await writeFile(
    path.join(directory, 'modeltrace-history.jsonl'),
    `${JSON.stringify(legacy)}\nbad line\n`,
  );
  const prompt = {
    accountId: 1,
    accountName: 'test',
    model: 'custom',
    method: 'prompt' as const,
    prompt: '题目\n| 表格 |',
    output: '完整回答\n\n第二段',
    finishReason: 'length',
    durationMs: 1000,
    detectedAt: '2026-09-12T00:00:00Z',
  };
  await appendHistory(prompt);
  expect((await latestByAccount()).get(1)).toEqual(legacy);
  expect((await latestByAccount('prompt')).get(1)).toEqual(prompt);
  expect(await listHistory(1)).toEqual([prompt, legacy]);
  expect(await listHistory(2)).toEqual([]);
});
