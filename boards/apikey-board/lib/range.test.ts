import { describe, expect, it } from 'vitest';

import { parseGroupId, parseRange, rangeLabel, trendGranularity } from '@/lib/range';

describe('range helpers', () => {
  it('normalizes unsupported ranges to today', () => {
    expect(parseRange(null)).toBe('today');
    expect(parseRange('week')).toBe('today');
  });

  it('preserves supported ranges', () => {
    expect(parseRange('7d')).toBe('7d');
    expect(parseRange('today')).toBe('today');
  });

  it('parses positive integer group ids', () => {
    expect(parseGroupId('12')).toBe(12);
    expect(parseGroupId('all')).toBeNull();
    expect(parseGroupId(null)).toBeNull();
    expect(parseGroupId('0')).toBeNull();
    expect(parseGroupId('-1')).toBeNull();
    expect(parseGroupId('abc')).toBeNull();
    expect(parseGroupId('1.5')).toBeNull();
  });

  it('returns localized labels', () => {
    expect(rangeLabel('today', 'zh')).toBe('今日累计');
    expect(rangeLabel('7d', 'en')).toBe('Last 7 Days');
  });

  it('maps ranges to granularity', () => {
    expect(trendGranularity('today')).toBe('hour');
    expect(trendGranularity('7d')).toBe('day');
  });
});
