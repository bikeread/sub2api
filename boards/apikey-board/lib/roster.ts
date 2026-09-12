import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Pool } from 'pg';

import type { RosterPayload } from '@/lib/types';

function rosterDirectory(): string {
  if (process.env.ADOPTION_ROSTER_PATH) {
    return path.dirname(process.env.ADOPTION_ROSTER_PATH);
  }
  return process.env.ADOPTION_ROSTER_DIR || '/app/data';
}

function rosterPath(): string {
  return process.env.ADOPTION_ROSTER_PATH || path.join(rosterDirectory(), 'roster.json');
}

export function normalizeRosterNames(names: unknown[]): string[] {
  return Array.from(
    new Set(names.map((name) => String(name || '').trim()).filter((name) => name.length > 0)),
  ).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
}

export function activeRosterNames(names: string[]): string[] | null {
  return names.length > 0 ? names : null;
}

export async function readRoster(): Promise<string[]> {
  try {
    const raw = await fs.readFile(rosterPath(), 'utf-8');
    const parsed = JSON.parse(raw) as { names?: unknown };
    return Array.isArray(parsed.names) ? normalizeRosterNames(parsed.names) : [];
  } catch {
    return [];
  }
}

export async function writeRoster(names: unknown[]): Promise<{ names: string[]; updatedAt: string }> {
  const directory = rosterDirectory();
  await fs.mkdir(directory, { recursive: true });

  const payload = {
    names: normalizeRosterNames(names),
    updatedAt: new Date().toISOString(),
  };
  const targetPath = rosterPath();
  const temporaryPath = `${targetPath}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(payload, null, 2), 'utf-8');
  await fs.rename(temporaryPath, targetPath);
  return payload;
}

export async function getRoster(
  pool: Pool,
  groupId: number | null = null,
  names: string[] = [],
): Promise<RosterPayload> {
  const [{ rows }, rosterNames] = await Promise.all([
    pool.query(
      `SELECT id, name
       FROM api_keys
       WHERE deleted_at IS NULL
         AND status = 'active'
         AND ($1::bigint IS NULL OR group_id = $1::bigint)
       ORDER BY name ASC`,
      [groupId],
    ),
    Promise.resolve(names),
  ]);
  const selectedNames = new Set(rosterNames);

  return {
    names: rosterNames,
    availableKeys: rows.map((row) => {
      const name = String(row.name || `key-${row.id}`);
      return {
        id: Number(row.id),
        name,
        inRoster: selectedNames.has(name),
      };
    }),
  };
}
