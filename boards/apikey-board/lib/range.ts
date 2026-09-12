import type { BoardRange } from '@/lib/types';

export function parseRange(raw: string | null): BoardRange {
  return raw === '7d' ? '7d' : 'today';
}

export function parseGroupId(raw: string | null): number | null {
  if (!raw || raw === 'all') return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function rangeLabel(range: BoardRange, lang: string): string {
  const isZh = lang.startsWith('zh');
  if (range === '7d') {
    return isZh ? '最近7天' : 'Last 7 Days';
  }
  return isZh ? '今日累计' : 'Today';
}

export function trendGranularity(range: BoardRange): 'hour' | 'day' {
  return range === 'today' ? 'hour' : 'day';
}
