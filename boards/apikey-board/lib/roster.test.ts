import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  activeRosterNames,
  normalizeRosterNames,
  readRoster,
  writeRoster,
} from '@/lib/roster';

describe('roster persistence', () => {
  let directory: string;
  let originalPath: string | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'apikey-board-roster-'));
    originalPath = process.env.ADOPTION_ROSTER_PATH;
    process.env.ADOPTION_ROSTER_PATH = path.join(directory, 'roster.json');
  });

  afterEach(async () => {
    if (originalPath === undefined) delete process.env.ADOPTION_ROSTER_PATH;
    else process.env.ADOPTION_ROSTER_PATH = originalPath;
    await rm(directory, { recursive: true, force: true });
  });

  it('normalizes, deduplicates, and sorts roster names', () => {
    expect(normalizeRosterNames([' 张三 ', '李四', '张三', '', null])).toEqual(['李四', '张三']);
  });

  it('treats an empty roster as an inactive filter', () => {
    expect(activeRosterNames([])).toBeNull();
    expect(activeRosterNames(['张三'])).toEqual(['张三']);
  });

  it('writes atomically and reads the normalized roster', async () => {
    const saved = await writeRoster([' 张三 ', '李四', '张三']);

    expect(saved.names).toEqual(['李四', '张三']);
    expect(await readRoster()).toEqual(['李四', '张三']);
    const onDisk = JSON.parse(await readFile(process.env.ADOPTION_ROSTER_PATH!, 'utf-8'));
    expect(onDisk.names).toEqual(['李四', '张三']);
    expect(onDisk.updatedAt).toBe(saved.updatedAt);
  });

  it('returns an empty roster when the file is absent', async () => {
    expect(await readRoster()).toEqual([]);
  });
});
