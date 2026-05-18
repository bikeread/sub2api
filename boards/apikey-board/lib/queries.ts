import type { Pool } from 'pg';

import { appConfig } from '@/lib/config';
import { trendGranularity } from '@/lib/range';
import type {
  BoardRange,
  GroupOption,
  GroupsPayload,
  ModelStatsPayload,
  ModelStatsRow,
  RankingPayload,
  RankingRow,
  SummaryPayload,
  TrendPayload,
  TrendPoint,
  TrendSeries,
} from '@/lib/types';

const TOKENS_SQL =
  'COALESCE(SUM(ul.input_tokens + ul.output_tokens + ul.cache_creation_tokens + ul.cache_read_tokens), 0)';

const CACHE_HIT_RATE_SQL =
  'SUM(ul.cache_read_tokens)::float / NULLIF(SUM(ul.input_tokens + ul.cache_creation_tokens + ul.cache_read_tokens), 0)';

type GroupFilterSql = {
  clause: string;
  params: number[];
};

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function boundsSql(range: BoardRange) {
  const startExpr =
    range === '7d'
      ? "(date_trunc('day', now() AT TIME ZONE $1) - interval '6 day') AT TIME ZONE $1"
      : "date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1";

  return `
    WITH bounds AS (
      SELECT
        ${startExpr} AS start_at,
        (date_trunc('day', now() AT TIME ZONE $1) + interval '1 day') AT TIME ZONE $1 AS end_at
    )
  `;
}

function usageGroupFilter(groupId: number | null, paramIndex: number): GroupFilterSql {
  if (!groupId) {
    return { clause: '', params: [] };
  }
  return {
    clause: `AND ul.group_id = $${paramIndex}`,
    params: [groupId],
  };
}

function apiKeyGroupFilter(groupId: number | null, paramIndex: number): GroupFilterSql {
  if (!groupId) {
    return { clause: '', params: [] };
  }
  return {
    clause: `AND group_id = $${paramIndex}`,
    params: [groupId],
  };
}

export async function getGroups(pool: Pool): Promise<GroupsPayload> {
  const sql = `
    SELECT id, name, platform, status, sort_order
    FROM groups
    WHERE deleted_at IS NULL
      AND status = 'active'
    ORDER BY sort_order ASC, id ASC
  `;

  const { rows } = await pool.query(sql);
  return {
    generatedAt: new Date().toISOString(),
    rows: rows.map((row): GroupOption => ({
      id: Number(row.id),
      name: String(row.name || ''),
      platform: String(row.platform || ''),
      status: String(row.status || 'unknown'),
      sortOrder: Number(row.sort_order || 0),
    })),
  };
}

export async function getSummary(
  pool: Pool,
  range: BoardRange,
  groupId: number | null = null,
): Promise<SummaryPayload> {
  const keyFilter = apiKeyGroupFilter(groupId, 2);
  const usageFilter = usageGroupFilter(groupId, 2);
  const sql = `
    ${boundsSql(range)},
    key_stats AS (
      SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total_keys,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'active') AS active_keys
      FROM api_keys
      WHERE deleted_at IS NULL
        ${keyFilter.clause}
    ),
    usage_window AS (
      SELECT
        COUNT(*) AS total_requests,
        COUNT(DISTINCT ul.api_key_id) AS used_keys,
        COALESCE(SUM(ul.input_tokens + ul.cache_creation_tokens + ul.cache_read_tokens), 0) AS input_tokens,
        COALESCE(SUM(ul.output_tokens), 0) AS output_tokens,
        COALESCE(SUM(ul.cache_read_tokens), 0) AS cache_tokens,
        ${TOKENS_SQL} AS total_tokens,
        ${CACHE_HIT_RATE_SQL} AS cache_hit_rate,
        COALESCE(AVG(ul.duration_ms) FILTER (WHERE ul.duration_ms IS NOT NULL), 0) AS average_duration_ms
      FROM usage_logs ul
      CROSS JOIN bounds b
      WHERE ul.created_at >= b.start_at
        AND ul.created_at < b.end_at
        ${usageFilter.clause}
    )
    SELECT
      ks.total_keys,
      ks.active_keys,
      uw.used_keys,
      uw.input_tokens,
      uw.output_tokens,
      uw.cache_tokens,
      uw.total_tokens,
      uw.total_requests,
      uw.cache_hit_rate,
      uw.average_duration_ms
    FROM key_stats ks
    CROSS JOIN usage_window uw
  `;

  const params = [appConfig.timezone, ...usageFilter.params];
  const { rows } = await pool.query(sql, params);
  const row = rows[0] as {
    total_keys: string | number;
    active_keys: string | number;
    used_keys: string | number;
    input_tokens: string | number;
    output_tokens: string | number;
    cache_tokens: string | number;
    total_tokens: string | number;
    total_requests: string | number;
    cache_hit_rate: string | number | null;
    average_duration_ms: string | number;
  };

  return {
    range,
    groupId,
    timezone: appConfig.timezone,
    generatedAt: new Date().toISOString(),
    totalKeys: Number(row?.total_keys ?? 0),
    activeKeys: Number(row?.active_keys ?? 0),
    usedKeys: Number(row?.used_keys ?? 0),
    inputTokens: Number(row?.input_tokens ?? 0),
    outputTokens: Number(row?.output_tokens ?? 0),
    cacheTokens: Number(row?.cache_tokens ?? 0),
    totalTokens: Number(row?.total_tokens ?? 0),
    totalRequests: Number(row?.total_requests ?? 0),
    cacheHitRate: toNullableNumber(row?.cache_hit_rate),
    averageDurationMs: Number(row?.average_duration_ms ?? 0),
  };
}

export async function getRanking(
  pool: Pool,
  range: BoardRange,
  limit = 20,
  groupId: number | null = null,
): Promise<RankingPayload> {
  const filter = usageGroupFilter(groupId, 3);
  const sql = `
    ${boundsSql(range)},
    usage_window AS (
      SELECT
        ul.api_key_id,
        COUNT(*) AS requests,
        COALESCE(SUM(ul.input_tokens + ul.cache_creation_tokens + ul.cache_read_tokens), 0) AS input_tokens,
        COALESCE(SUM(ul.output_tokens), 0) AS output_tokens,
        COALESCE(SUM(ul.cache_read_tokens), 0) AS cache_tokens,
        ${TOKENS_SQL} AS tokens,
        ${CACHE_HIT_RATE_SQL} AS cache_hit_rate,
        COALESCE(AVG(ul.duration_ms) FILTER (WHERE ul.duration_ms IS NOT NULL), 0) AS average_duration_ms
      FROM usage_logs ul
      CROSS JOIN bounds b
      WHERE ul.created_at >= b.start_at
        AND ul.created_at < b.end_at
        ${filter.clause}
      GROUP BY ul.api_key_id
    )
    SELECT
      ak.id AS api_key_id,
      ak.name AS key_name,
      ak.status,
      ak.last_used_at,
      uw.requests,
      uw.input_tokens,
      uw.output_tokens,
      uw.cache_tokens,
      uw.tokens,
      uw.cache_hit_rate,
      uw.average_duration_ms
    FROM usage_window uw
    INNER JOIN api_keys ak
      ON ak.id = uw.api_key_id
     AND ak.deleted_at IS NULL
    WHERE uw.tokens > 0 OR uw.requests > 0
    ORDER BY uw.tokens DESC, uw.requests DESC, ak.id ASC
    LIMIT $2
  `;

  const { rows } = await pool.query(sql, [appConfig.timezone, limit, ...filter.params]);

  const mapped: RankingRow[] = rows.map((row) => ({
    apiKeyId: Number(row.api_key_id),
    keyName: String(row.key_name || ''),
    status: String(row.status || 'unknown'),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    requests: Number(row.requests || 0),
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    cacheTokens: Number(row.cache_tokens || 0),
    tokens: Number(row.tokens || 0),
    cacheHitRate: toNullableNumber(row.cache_hit_rate),
    averageDurationMs:
      row.average_duration_ms === null || row.average_duration_ms === undefined
        ? null
        : Number(row.average_duration_ms || 0),
  }));

  return {
    range,
    groupId,
    generatedAt: new Date().toISOString(),
    rows: mapped,
  };
}

type RawTrendRow = {
  bucket_key: string;
  label: string;
  requests: string | number;
  tokens: string | number;
};

type RawTopSeriesRow = RawTrendRow & {
  api_key_id: string | number;
  key_name: string;
};

export async function getTrend(
  pool: Pool,
  range: BoardRange,
  groupId: number | null = null,
): Promise<TrendPayload> {
  const granularity = trendGranularity(range);
  const filter = usageGroupFilter(groupId, 2);
  const bucketExpr =
    granularity === 'hour'
      ? "date_trunc('hour', ul.created_at AT TIME ZONE $1)"
      : "date_trunc('day', ul.created_at AT TIME ZONE $1)";
  const labelExpr =
    granularity === 'hour'
      ? "TO_CHAR(bucket_local, 'HH24:00')"
      : "TO_CHAR(bucket_local, 'MM-DD')";

  const totalSql = `
    ${boundsSql(range)}
    SELECT
      TO_CHAR(bucket_local, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS bucket_key,
      ${labelExpr} AS label,
      COUNT(*) AS requests,
      COALESCE(SUM(ul.input_tokens + ul.output_tokens + ul.cache_creation_tokens + ul.cache_read_tokens), 0) AS tokens
    FROM (
      SELECT ${bucketExpr} AS bucket_local, ul.*
      FROM usage_logs ul
      CROSS JOIN bounds b
      WHERE ul.created_at >= b.start_at
        AND ul.created_at < b.end_at
        ${filter.clause}
    ) ul
    GROUP BY bucket_local
    ORDER BY bucket_local ASC
  `;

  const topKeysSql = `
    ${boundsSql(range)},
    top_keys AS (
      SELECT
        ul.api_key_id,
        SUM(ul.input_tokens + ul.output_tokens + ul.cache_creation_tokens + ul.cache_read_tokens) AS tokens
      FROM usage_logs ul
      CROSS JOIN bounds b
      WHERE ul.created_at >= b.start_at
        AND ul.created_at < b.end_at
        ${filter.clause}
      GROUP BY ul.api_key_id
      ORDER BY tokens DESC, ul.api_key_id ASC
      LIMIT 5
    )
    SELECT
      TO_CHAR(bucket_local, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS bucket_key,
      ${labelExpr} AS label,
      ul.api_key_id,
      COALESCE(ak.name, '') AS key_name,
      COUNT(*) AS requests,
      COALESCE(SUM(ul.input_tokens + ul.output_tokens + ul.cache_creation_tokens + ul.cache_read_tokens), 0) AS tokens
    FROM (
      SELECT ${bucketExpr} AS bucket_local, ul.*
      FROM usage_logs ul
      CROSS JOIN bounds b
      WHERE ul.created_at >= b.start_at
        AND ul.created_at < b.end_at
        AND ul.api_key_id IN (SELECT api_key_id FROM top_keys)
        ${filter.clause}
    ) ul
    LEFT JOIN api_keys ak
      ON ak.id = ul.api_key_id
    GROUP BY bucket_local, ul.api_key_id, ak.name
    ORDER BY bucket_local ASC, tokens DESC
  `;

  const [totalResult, topResult] = await Promise.all([
    pool.query(totalSql, [appConfig.timezone, ...filter.params]),
    pool.query(topKeysSql, [appConfig.timezone, ...filter.params]),
  ]);

  const total: TrendPoint[] = totalResult.rows.map((row: RawTrendRow) => ({
    bucket: String(row.bucket_key),
    label: String(row.label),
    requests: Number(row.requests || 0),
    tokens: Number(row.tokens || 0),
  }));

  const seriesByKey = new Map<number, TrendSeries>();
  for (const row of topResult.rows as RawTopSeriesRow[]) {
    const apiKeyId = Number(row.api_key_id);
    if (!seriesByKey.has(apiKeyId)) {
      seriesByKey.set(apiKeyId, {
        apiKeyId,
        keyName: String(row.key_name || ''),
        points: [],
      });
    }
    seriesByKey.get(apiKeyId)!.points.push({
      bucket: String(row.bucket_key),
      label: String(row.label),
      requests: Number(row.requests || 0),
      tokens: Number(row.tokens || 0),
    });
  }

  return {
    range,
    groupId,
    granularity,
    generatedAt: new Date().toISOString(),
    total,
    topKeys: Array.from(seriesByKey.values()),
  };
}

export async function getModelStats(
  pool: Pool,
  range: BoardRange,
  limit = 10,
  groupId: number | null = null,
): Promise<ModelStatsPayload> {
  const filter = usageGroupFilter(groupId, 3);
  const sql = `
    ${boundsSql(range)}
    SELECT
      COALESCE(NULLIF(ul.model, ''), 'unknown') AS model,
      COUNT(*) AS requests,
      COALESCE(SUM(ul.input_tokens + ul.cache_creation_tokens + ul.cache_read_tokens), 0) AS input_tokens,
      COALESCE(SUM(ul.output_tokens), 0) AS output_tokens,
      COALESCE(SUM(ul.cache_read_tokens), 0) AS cache_tokens,
      ${TOKENS_SQL} AS tokens,
      ${CACHE_HIT_RATE_SQL} AS cache_hit_rate,
      COALESCE(AVG(ul.duration_ms) FILTER (WHERE ul.duration_ms IS NOT NULL), 0) AS average_duration_ms
    FROM usage_logs ul
    CROSS JOIN bounds b
    WHERE ul.created_at >= b.start_at
      AND ul.created_at < b.end_at
      ${filter.clause}
    GROUP BY model
    HAVING COUNT(*) > 0
    ORDER BY tokens DESC, requests DESC, model ASC
    LIMIT $2
  `;

  const { rows } = await pool.query(sql, [appConfig.timezone, limit, ...filter.params]);
  const mapped: ModelStatsRow[] = rows.map((row) => ({
    model: String(row.model || 'unknown'),
    requests: Number(row.requests || 0),
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    cacheTokens: Number(row.cache_tokens || 0),
    tokens: Number(row.tokens || 0),
    cacheHitRate: toNullableNumber(row.cache_hit_rate),
    averageDurationMs:
      row.average_duration_ms === null || row.average_duration_ms === undefined
        ? null
        : Number(row.average_duration_ms || 0),
  }));

  return {
    range,
    groupId,
    generatedAt: new Date().toISOString(),
    rows: mapped,
  };
}
