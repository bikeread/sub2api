// 巡检状态与历史落盘：data/modeltrace-state.json / data/modeltrace-history.jsonl

import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

import type { HistoryEntry } from './types';
import type { DetectionMethod } from './request';
export type { HistoryEntry } from './types';

const DATA_DIR =
  process.env.MODELTRACE_DATA_DIR || path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'modeltrace-state.json');
const HISTORY_FILE = path.join(DATA_DIR, 'modeltrace-history.jsonl');

export interface ProbeRoute {
  accountId: number;
  accountName: string;
  groupId: number;
  apiKey: string;
  createdAt: string;
}

interface State {
  routes: ProbeRoute[];
}

async function readState(): Promise<State> {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as State;
    return { routes: Array.isArray(parsed.routes) ? parsed.routes : [] };
  } catch {
    return { routes: [] };
  }
}

export async function getProbeRoute(
  accountId: number,
): Promise<ProbeRoute | null> {
  const state = await readState();
  return state.routes.find((r) => r.accountId === accountId) ?? null;
}

export async function saveProbeRoute(route: ProbeRoute): Promise<void> {
  const state = await readState();
  const index = state.routes.findIndex((r) => r.accountId === route.accountId);
  if (index >= 0) state.routes[index] = route;
  else state.routes.push(route);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

export async function appendHistory(entry: HistoryEntry): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await appendFile(HISTORY_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
}

export async function listHistory(accountId?: number): Promise<HistoryEntry[]> {
  let raw: string;
  try {
    raw = await readFile(HISTORY_FILE, 'utf8');
  } catch {
    return [];
  }
  const entries: HistoryEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as HistoryEntry;
      if (accountId === undefined || entry.accountId === accountId) {
        entries.push(entry);
      }
    } catch {
      // 跳过坏行
    }
  }
  return entries.reverse();
}

/** 每个账号最近一次检测结论，用于列表页展示。 */
export async function latestByAccount(
  method: DetectionMethod = 'fingerprint',
): Promise<Map<number, HistoryEntry>> {
  const all = await listHistory();
  const map = new Map<number, HistoryEntry>();
  for (const entry of all) {
    if ((entry.method ?? 'fingerprint') === method && !map.has(entry.accountId))
      map.set(entry.accountId, entry);
  }
  return map;
}
