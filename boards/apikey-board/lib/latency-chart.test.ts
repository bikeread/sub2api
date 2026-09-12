import { describe, expect, it } from 'vitest';

import {
  formatLatencyTick,
  formatLatencyValue,
  latencyTickValues,
  latencyYDomain,
  splitSeries,
  trimTrailingEmptyBuckets,
  xTickIndexes,
} from '@/lib/latency-chart';
import type { LatencyHealthPoint } from '@/lib/types';

function point(overrides: Partial<LatencyHealthPoint>): LatencyHealthPoint {
  return {
    bucket: 'b',
    label: 'L',
    p50: null,
    p95: null,
    p99: null,
    slowCount: 0,
    requests: 0,
    ...overrides,
  };
}

describe('formatLatencyTick', () => {
  it('formats milliseconds, seconds and minutes with rounding', () => {
    expect(formatLatencyTick(5)).toBe('5ms');
    expect(formatLatencyTick(1000)).toBe('1s');
    expect(formatLatencyTick(1500)).toBe('1.5s');
    expect(formatLatencyTick(100000)).toBe('100s');
    expect(formatLatencyTick(120000)).toBe('2m');
    expect(formatLatencyTick(150000)).toBe('2.5m');
  });
});

describe('formatLatencyValue', () => {
  it('renders a dash for missing values', () => {
    expect(formatLatencyValue(null, 'zh')).toBe('—');
  });

  it('localizes units', () => {
    expect(formatLatencyValue(420, 'zh')).toBe('420 毫秒');
    expect(formatLatencyValue(420, 'en')).toBe('420 ms');
    expect(formatLatencyValue(5200, 'zh')).toBe('5.2 秒');
    expect(formatLatencyValue(58207, 'en')).toBe('58 s');
  });
});

describe('latencyTickValues', () => {
  it('spans only the decades covering the data', () => {
    expect(latencyTickValues(1132, 58207)).toEqual([1000, 2000, 5000, 10000, 20000, 50000, 100000]);
  });

  it('always includes a cap tick above the max', () => {
    expect(latencyTickValues(1200, 1300)).toEqual([1000, 2000]);
  });
});

describe('latencyYDomain', () => {
  it('returns an empty domain when no percentile data exists', () => {
    expect(latencyYDomain([point({})])).toEqual({ ticks: [], minLog: 0, maxLog: 1 });
  });

  it('builds a log domain around the data', () => {
    const domain = latencyYDomain([point({ p50: 4000, p95: 20000, p99: 45000 })]);
    expect(domain.ticks[0]).toBe(1000);
    expect(domain.ticks[domain.ticks.length - 1]).toBe(50000);
    expect(domain.maxLog).toBeGreaterThan(domain.minLog);
  });
});

describe('trimTrailingEmptyBuckets', () => {
  it('drops trailing buckets without requests, slow counts or errors', () => {
    const points = [
      point({ bucket: 'a', requests: 10 }),
      point({ bucket: 'b', requests: 3 }),
      point({ bucket: 'c' }),
      point({ bucket: 'd' }),
    ];
    expect(trimTrailingEmptyBuckets(points, []).map((p) => p.bucket)).toEqual(['a', 'b']);
  });

  it('keeps trailing buckets that carry errors or slow requests', () => {
    const points = [point({ bucket: 'a', requests: 10 }), point({ bucket: 'b', slowCount: 1 })];
    expect(trimTrailingEmptyBuckets(points, [])).toHaveLength(2);
    const withError = trimTrailingEmptyBuckets(points, [
      { bucket: 'b', label: 'L', count: 1, events: [] },
    ]);
    expect(withError).toHaveLength(2);
  });

  it('keeps at least one bucket', () => {
    expect(trimTrailingEmptyBuckets([point({ bucket: 'a' })], [])).toHaveLength(1);
  });
});

describe('xTickIndexes', () => {
  it('labels every bucket when there are few', () => {
    expect(xTickIndexes(5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('thins labels but always keeps the first and last bucket', () => {
    const indexes = xTickIndexes(24);
    expect(indexes[0]).toBe(0);
    expect(indexes[indexes.length - 1]).toBe(23);
    expect(indexes.length).toBeLessThanOrEqual(8);
  });
});

describe('splitSeries', () => {
  it('breaks lines at gaps and reports isolated points as dots', () => {
    const { segments, dots } = splitSeries([100, 200, null, 300, null, null, 400, 500, 600]);
    expect(segments).toEqual([[0, 1], [6, 8]]);
    expect(dots).toEqual([3]);
  });

  it('treats non-positive values as gaps', () => {
    const { segments, dots } = splitSeries([null, 0, null]);
    expect(segments).toEqual([]);
    expect(dots).toEqual([]);
  });

  it('handles a single point series as a dot', () => {
    const { segments, dots } = splitSeries([500]);
    expect(segments).toEqual([]);
    expect(dots).toEqual([0]);
  });
});
