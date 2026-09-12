import type {
  LatencyAccountSeries,
  LatencyErrorGroup,
  LatencyHealthPoint,
} from '@/lib/types';

export type LatencyBucket = Pick<LatencyHealthPoint, 'bucket' | 'label'>;

export type RawLatencyPointRow = {
  bucket_key: string;
  label: string;
  p50: string | number | null;
  p95: string | number | null;
  p99: string | number | null;
  slow_count: string | number;
  requests: string | number;
};

export type RawLatencyAccountRow = {
  bucket_key: string;
  label: string;
  account_id: string | number | null;
  account_name: string | null;
  p95: string | number | null;
  requests: string | number;
};

export type RawLatencyErrorRow = {
  bucket_key: string;
  label: string;
  at: string;
  account_id: string | number | null;
  status_code: string | number;
  latency_ms: string | number | null;
};

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toZero(value: string | number | null | undefined): number {
  return toNumber(value) ?? 0;
}

function bucketsFromRows(rows: RawLatencyPointRow[]): LatencyBucket[] {
  const seen = new Set<string>();
  const buckets: LatencyBucket[] = [];

  for (const row of rows) {
    const bucket = String(row.bucket_key);
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    buckets.push({ bucket, label: String(row.label) });
  }

  return buckets;
}

export function normalizeLatencyPoints(
  rows: RawLatencyPointRow[],
  buckets: LatencyBucket[] = bucketsFromRows(rows),
): LatencyHealthPoint[] {
  const byBucket = new Map(
    rows.map((row) => [
      String(row.bucket_key),
      {
        p50: toNumber(row.p50),
        p95: toNumber(row.p95),
        p99: toNumber(row.p99),
        slowCount: toZero(row.slow_count),
        requests: toZero(row.requests),
      },
    ]),
  );

  return buckets.map((bucket) => {
    const point = byBucket.get(bucket.bucket);
    return {
      bucket: bucket.bucket,
      label: bucket.label,
      p50: point?.p50 ?? null,
      p95: point?.p95 ?? null,
      p99: point?.p99 ?? null,
      slowCount: point?.slowCount ?? 0,
      requests: point?.requests ?? 0,
    };
  });
}

export function normalizeLatencyAccounts(
  rows: RawLatencyAccountRow[],
  buckets: LatencyBucket[] = [],
): LatencyAccountSeries[] {
  if (buckets.length === 0) return [];

  const bucketIndex = new Map(buckets.map((bucket, index) => [bucket.bucket, index]));
  const byAccount = new Map<number, LatencyAccountSeries>();

  for (const row of rows) {
    const accountId = toNumber(row.account_id);
    if (accountId === null) continue;
    const pointIndex = bucketIndex.get(String(row.bucket_key));
    if (pointIndex === undefined) continue;

    let series = byAccount.get(accountId);
    if (!series) {
      series = {
        accountId,
        accountName: String(row.account_name || `account-${accountId}`),
        points: buckets.map((item) => ({
          bucket: item.bucket,
          label: item.label,
          p95: null,
          requests: 0,
        })),
      };
      byAccount.set(accountId, series);
    }

    series.points[pointIndex] = {
      bucket: String(row.bucket_key),
      label: String(row.label),
      p95: toNumber(row.p95),
      requests: toZero(row.requests),
    };
  }

  return Array.from(byAccount.values()).sort((a, b) => (a.accountId ?? 0) - (b.accountId ?? 0));
}

export function normalizeLatencyErrors(
  rows: RawLatencyErrorRow[],
  buckets: LatencyBucket[] = [],
): LatencyErrorGroup[] {
  const bucketIndex = new Map(buckets.map((bucket, index) => [bucket.bucket, index]));
  const byBucket = new Map<string, LatencyErrorGroup>();

  for (const row of rows) {
    const bucket = String(row.bucket_key);
    if (!bucketIndex.has(bucket)) continue;

    let group = byBucket.get(bucket);
    if (!group) {
      group = { bucket, label: String(row.label), count: 0, events: [] };
      byBucket.set(bucket, group);
    }
    group.count += 1;
    group.events.push({
      at: String(row.at),
      accountId: toNumber(row.account_id),
      statusCode: toZero(row.status_code),
      latencyMs: toNumber(row.latency_ms) ?? 0,
    });
  }

  return Array.from(byBucket.values()).sort(
    (a, b) => (bucketIndex.get(a.bucket) ?? 0) - (bucketIndex.get(b.bucket) ?? 0),
  );
}
