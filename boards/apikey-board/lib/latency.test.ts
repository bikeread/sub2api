import { describe, expect, it } from 'vitest';

import {
  normalizeLatencyAccounts,
  normalizeLatencyErrors,
  normalizeLatencyPoints,
  type RawLatencyAccountRow,
  type RawLatencyErrorRow,
  type RawLatencyPointRow,
} from '@/lib/latency';

const BUCKETS: { bucket: string; label: string }[] = [
  { bucket: '2026-08-10T09:00:00', label: '09:00' },
  { bucket: '2026-08-10T10:00:00', label: '10:00' },
  { bucket: '2026-08-10T11:00:00', label: '11:00' },
];

describe('normalizeLatencyPoints', () => {
  it('fills missing buckets with null percentiles and zero counts', () => {
    const rows: RawLatencyPointRow[] = [
      {
        bucket_key: BUCKETS[1].bucket,
        label: '10:00',
        p50: '2855',
        p95: '7267',
        p99: null,
        slow_count: '3',
        requests: '120',
      },
    ];

    const points = normalizeLatencyPoints(rows, BUCKETS);

    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({
      bucket: BUCKETS[0].bucket,
      label: '09:00',
      p50: null,
      p95: null,
      p99: null,
      slowCount: 0,
      requests: 0,
    });
    expect(points[1]).toEqual({
      bucket: BUCKETS[1].bucket,
      label: '10:00',
      p50: 2855,
      p95: 7267,
      p99: null,
      slowCount: 3,
      requests: 120,
    });
  });

  it('derives buckets from rows when none are given', () => {
    const rows: RawLatencyPointRow[] = [
      { bucket_key: 'a', label: 'A', p50: '1', p95: '2', p99: '3', slow_count: '0', requests: '5' },
      { bucket_key: 'b', label: 'B', p50: null, p95: null, p99: null, slow_count: '0', requests: '0' },
    ];

    const points = normalizeLatencyPoints(rows);

    expect(points.map((point) => point.bucket)).toEqual(['a', 'b']);
  });
});

describe('normalizeLatencyAccounts', () => {
  it('aligns account p95 series onto the bucket grid', () => {
    const rows: RawLatencyAccountRow[] = [
      { bucket_key: BUCKETS[0].bucket, label: '09:00', account_id: '1', account_name: 'Json-pro 20x', p95: '5000', requests: '10' },
      { bucket_key: BUCKETS[2].bucket, label: '11:00', account_id: '1', account_name: 'Json-pro 20x', p95: '9000', requests: '12' },
      { bucket_key: BUCKETS[1].bucket, label: '10:00', account_id: '2', account_name: 'RW-pro', p95: '3000', requests: '8' },
    ];

    const series = normalizeLatencyAccounts(rows, BUCKETS);

    expect(series).toHaveLength(2);
    expect(series[0].accountId).toBe(1);
    expect(series[0].points).toHaveLength(3);
    expect(series[0].points[0].p95).toBe(5000);
    expect(series[0].points[1].p95).toBeNull();
    expect(series[0].points[2].p95).toBe(9000);
    expect(series[1].accountId).toBe(2);
  });

  it('returns empty when there are no buckets', () => {
    expect(normalizeLatencyAccounts([], [])).toEqual([]);
  });

  it('skips rows with null account ids', () => {
    const rows: RawLatencyAccountRow[] = [
      { bucket_key: BUCKETS[0].bucket, label: '09:00', account_id: null, account_name: null, p95: '1', requests: '1' },
    ];

    expect(normalizeLatencyAccounts(rows, BUCKETS)).toEqual([]);
  });
});

describe('normalizeLatencyErrors', () => {
  it('groups error events by bucket in bucket order', () => {
    const rows: RawLatencyErrorRow[] = [
      { bucket_key: BUCKETS[2].bucket, label: '11:00', at: '08-10 11:05', account_id: '1', status_code: '408', latency_ms: '1560763' },
      { bucket_key: BUCKETS[0].bucket, label: '09:00', at: '08-10 09:02', account_id: '2', status_code: '503', latency_ms: '1438' },
      { bucket_key: BUCKETS[0].bucket, label: '09:00', at: '08-10 09:07', account_id: '1', status_code: '524', latency_ms: '1800016' },
    ];

    const groups = normalizeLatencyErrors(rows, BUCKETS);

    expect(groups).toHaveLength(2);
    expect(groups[0].bucket).toBe(BUCKETS[0].bucket);
    expect(groups[0].count).toBe(2);
    expect(groups[0].events.map((event) => event.statusCode)).toEqual([503, 524]);
    expect(groups[1].bucket).toBe(BUCKETS[2].bucket);
    expect(groups[1].events[0].latencyMs).toBe(1560763);
  });

  it('ignores events outside the bucket grid', () => {
    const rows: RawLatencyErrorRow[] = [
      { bucket_key: 'unknown-bucket', label: 'x', at: '08-10 23:00', account_id: '1', status_code: '500', latency_ms: '100' },
    ];

    expect(normalizeLatencyErrors(rows, BUCKETS)).toEqual([]);
  });
});
