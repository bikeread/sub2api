import type { Pool } from 'pg';

import {
  hasCodexQuotaSnapshot,
  parseCodexQuotaWindow,
  parseExtraDate,
  parseExtraNumber,
} from '@/lib/account-quotas';
import { appConfig } from '@/lib/config';
import { buildQuotaProjections, summarizeVerdicts } from '@/lib/quota-projection';
import { trendGranularity } from '@/lib/range';
import { activeRosterNames } from '@/lib/roster';
import {
  normalizeLatencyAccounts,
  normalizeLatencyErrors,
  normalizeLatencyPoints,
  type RawLatencyAccountRow,
  type RawLatencyErrorRow,
  type RawLatencyPointRow,
} from '@/lib/latency';
import type {
  AccountQuotasPayload,
  AccountQuotaRow,
  BoardRange,
  GroupOption,
  GroupsPayload,
  LatencyHealthPayload,
  ModelStatsPayload,
  ModelStatsRow,
  QuotaProjectionAccount,
  QuotaProjectionBucket,
  QuotaProjectionPayload,
  RankingPayload,
  RankingRow,
  SummaryPayload,
} from '@/lib/types';

const TOKENS_SQL =
  'COALESCE(SUM(ul.input_tokens + ul.output_tokens + ul.cache_creation_tokens + ul.cache_read_tokens), 0)';

const CACHE_HIT_RATE_SQL =
  'SUM(ul.cache_read_tokens)::float / NULLIF(SUM(ul.input_tokens + ul.cache_creation_tokens + ul.cache_read_tokens), 0)';

const ACCOUNT_COST_SQL =
  'COALESCE(SUM(COALESCE(ul.account_stats_cost, ul.total_cost) * COALESCE(ul.account_rate_multiplier, 1)), 0)';

type GroupFilterSql = {
  clause: string;
  params: number[];
};

type RosterFilterSql = {
  clause: string;
  params: string[][];
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

function accountGroupFilter(groupId: number | null, paramIndex: number): GroupFilterSql {
  if (!groupId) {
    return { clause: '', params: [] };
  }
  return {
    clause: `AND EXISTS (
      SELECT 1
      FROM account_groups ag
      WHERE ag.account_id = a.id
        AND ag.group_id = $${paramIndex}
    )`,
    params: [groupId],
  };
}

function apiKeyRosterFilter(
  rosterNames: string[] | null,
  paramIndex: number,
  alias = 'ak',
): RosterFilterSql {
  if (!rosterNames) return { clause: '', params: [] };
  return {
    clause: `AND ${alias}.name = ANY($${paramIndex}::text[])`,
    params: [rosterNames],
  };
}

function usageRosterFilter(
  rosterNames: string[] | null,
  paramIndex: number,
): RosterFilterSql {
  if (!rosterNames) return { clause: '', params: [] };
  return {
    clause: `AND ul.api_key_id IN (
      SELECT roster_ak.id
      FROM api_keys roster_ak
      WHERE roster_ak.deleted_at IS NULL
        AND roster_ak.status = 'active'
        AND roster_ak.name = ANY($${paramIndex}::text[])
    )`,
    params: [rosterNames],
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
  rosterNames: string[] = [],
): Promise<SummaryPayload> {
  const roster = activeRosterNames(rosterNames);
  const keyFilter = apiKeyGroupFilter(groupId, 2);
  const usageFilter = usageGroupFilter(groupId, 2);
  const rosterParamIndex = 2 + usageFilter.params.length;
  const keyRosterFilter = apiKeyRosterFilter(roster, rosterParamIndex);
  const usageRoster = usageRosterFilter(roster, rosterParamIndex);
  const sql = `
    ${boundsSql(range)},
    key_stats AS (
      SELECT
        COUNT(*) FILTER (WHERE ak.deleted_at IS NULL) AS total_keys,
        COUNT(*) FILTER (WHERE ak.deleted_at IS NULL AND ak.status = 'active') AS active_keys
      FROM api_keys ak
      WHERE ak.deleted_at IS NULL
        ${keyFilter.clause}
        ${keyRosterFilter.clause}
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
        COALESCE(AVG(ul.first_token_ms) FILTER (WHERE ul.first_token_ms IS NOT NULL), 0) AS average_first_token_ms,
        MAX(ul.first_token_ms) AS max_first_token_ms,
        COUNT(*) FILTER (WHERE ul.first_token_ms > 60000) AS slow_request_count
      FROM usage_logs ul
      CROSS JOIN bounds b
      WHERE ul.created_at >= b.start_at
        AND ul.created_at < b.end_at
        ${usageFilter.clause}
        ${usageRoster.clause}
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
      uw.average_first_token_ms,
      uw.max_first_token_ms,
      uw.slow_request_count
    FROM key_stats ks
    CROSS JOIN usage_window uw
  `;

  const params = [appConfig.timezone, ...usageFilter.params, ...usageRoster.params];
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
    average_first_token_ms: string | number;
    max_first_token_ms: string | number | null;
    slow_request_count: string | number;
  };

  return {
    range,
    groupId,
    timezone: appConfig.timezone,
    generatedAt: new Date().toISOString(),
    rosterActive: roster !== null,
    rosterTotal: roster?.length ?? 0,
    totalKeys: Number(row?.total_keys ?? 0),
    activeKeys: Number(row?.active_keys ?? 0),
    usedKeys: Number(row?.used_keys ?? 0),
    inputTokens: Number(row?.input_tokens ?? 0),
    outputTokens: Number(row?.output_tokens ?? 0),
    cacheTokens: Number(row?.cache_tokens ?? 0),
    totalTokens: Number(row?.total_tokens ?? 0),
    totalRequests: Number(row?.total_requests ?? 0),
    cacheHitRate: toNullableNumber(row?.cache_hit_rate),
    averageFirstTokenMs: Number(row?.average_first_token_ms ?? 0),
    maxFirstTokenMs: toNullableNumber(row?.max_first_token_ms),
    slowRequestCount: Number(row?.slow_request_count ?? 0),
  };
}

export async function getRanking(
  pool: Pool,
  range: BoardRange,
  limit = 20,
  groupId: number | null = null,
  rosterNames: string[] = [],
): Promise<RankingPayload> {
  const roster = activeRosterNames(rosterNames);
  const filter = usageGroupFilter(groupId, 3);
  const rosterFilter = usageRosterFilter(roster, 3 + filter.params.length);
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
        ${rosterFilter.clause}
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

  const { rows } = await pool.query(sql, [
    appConfig.timezone,
    limit,
    ...filter.params,
    ...rosterFilter.params,
  ]);

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

export async function getLatencyHealth(
  pool: Pool,
  range: BoardRange,
  groupId: number | null = null,
  rosterNames: string[] = [],
): Promise<LatencyHealthPayload> {
  const roster = activeRosterNames(rosterNames);
  const granularity = trendGranularity(range);
  const filter = usageGroupFilter(groupId, 2);
  const rosterFilter = usageRosterFilter(roster, 2 + filter.params.length);
  const errorsFilter = groupId
    ? { clause: 'AND oe.group_id = $2', params: [groupId] as number[] }
    : { clause: '', params: [] as number[] };
  const bucketExpr = (alias: string) =>
    granularity === 'hour'
      ? `date_trunc('hour', ${alias}.created_at AT TIME ZONE $1)`
      : `date_trunc('day', ${alias}.created_at AT TIME ZONE $1)`;
  const stepExpr = granularity === 'hour' ? "interval '1 hour'" : "interval '1 day'";
  const labelExpr =
    granularity === 'hour'
      ? "TO_CHAR(bg.bucket_local, 'HH24:00')"
      : "TO_CHAR(bg.bucket_local, 'MM-DD')";
  const bucketKeyExpr =
    "TO_CHAR(bg.bucket_local, 'YYYY-MM-DD\"T\"HH24:MI:SS')";

  const pointsSql = `
    ${boundsSql(range)},
    bucket_grid AS (
      SELECT
        generate_series(
          b.start_at AT TIME ZONE $1,
          (b.end_at AT TIME ZONE $1) - ${stepExpr},
          ${stepExpr}
        ) AS bucket_local
      FROM bounds b
    ),
    usage_window AS (
      SELECT
        ${bucketExpr('ul')} AS bucket_local,
        COUNT(*) AS requests,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY ul.first_token_ms)
          FILTER (WHERE ul.first_token_ms IS NOT NULL) AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY ul.first_token_ms)
          FILTER (WHERE ul.first_token_ms IS NOT NULL) AS p95,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY ul.first_token_ms)
          FILTER (WHERE ul.first_token_ms IS NOT NULL) AS p99,
        COUNT(*) FILTER (WHERE ul.first_token_ms > 60000) AS slow_count
      FROM usage_logs ul
      CROSS JOIN bounds b
      WHERE ul.created_at >= b.start_at
        AND ul.created_at < b.end_at
        ${filter.clause}
        ${rosterFilter.clause}
      GROUP BY 1
    )
    SELECT
      ${bucketKeyExpr} AS bucket_key,
      ${labelExpr} AS label,
      COALESCE(uw.requests, 0) AS requests,
      uw.p50,
      uw.p95,
      uw.p99,
      COALESCE(uw.slow_count, 0) AS slow_count
    FROM bucket_grid bg
    LEFT JOIN usage_window uw
      ON uw.bucket_local = bg.bucket_local
    ORDER BY bg.bucket_local ASC
  `;

  const accountsSql = `
    ${boundsSql(range)},
    bucket_grid AS (
      SELECT
        generate_series(
          b.start_at AT TIME ZONE $1,
          (b.end_at AT TIME ZONE $1) - ${stepExpr},
          ${stepExpr}
        ) AS bucket_local
      FROM bounds b
    ),
    account_window AS (
      SELECT
        ${bucketExpr('ul')} AS bucket_local,
        ul.account_id,
        COUNT(*) AS requests,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY ul.first_token_ms)
          FILTER (WHERE ul.first_token_ms IS NOT NULL) AS p95
      FROM usage_logs ul
      CROSS JOIN bounds b
      WHERE ul.created_at >= b.start_at
        AND ul.created_at < b.end_at
        ${filter.clause}
        ${rosterFilter.clause}
      GROUP BY 1, 2
    )
    SELECT
      ${bucketKeyExpr} AS bucket_key,
      ${labelExpr} AS label,
      aw.account_id,
      COALESCE(a.name, '') AS account_name,
      aw.p95,
      aw.requests
    FROM account_window aw
    JOIN bucket_grid bg
      ON bg.bucket_local = aw.bucket_local
    LEFT JOIN accounts a
      ON a.id = aw.account_id
    ORDER BY aw.account_id ASC, bg.bucket_local ASC
  `;

  const errorsSql = `
    ${boundsSql(range)},
    bucket_grid AS (
      SELECT
        generate_series(
          b.start_at AT TIME ZONE $1,
          (b.end_at AT TIME ZONE $1) - ${stepExpr},
          ${stepExpr}
        ) AS bucket_local
      FROM bounds b
    ),
    error_window AS (
      SELECT
        ${bucketExpr('oe')} AS bucket_local,
        oe.created_at,
        oe.account_id,
        oe.upstream_status_code,
        oe.upstream_latency_ms
      FROM ops_error_logs oe
      CROSS JOIN bounds b
      WHERE oe.created_at >= b.start_at
        AND oe.created_at < b.end_at
        AND oe.error_type = 'upstream_error'
        AND oe.upstream_status_code IN (408, 500, 502, 503, 504, 507, 524)
        ${errorsFilter.clause}
    )
    SELECT
      ${bucketKeyExpr} AS bucket_key,
      ${labelExpr} AS label,
      TO_CHAR(ew.created_at AT TIME ZONE $1, 'MM-DD HH24:MI') AS at,
      ew.account_id,
      ew.upstream_status_code,
      ew.upstream_latency_ms
    FROM error_window ew
    JOIN bucket_grid bg
      ON bg.bucket_local = ew.bucket_local
    ORDER BY ew.created_at ASC
  `;

  const usageParams = [appConfig.timezone, ...filter.params, ...rosterFilter.params];
  const errorParams = [appConfig.timezone, ...errorsFilter.params];
  const [pointsRes, accountsRes, errorsRes] = await Promise.all([
    pool.query(pointsSql, usageParams),
    pool.query(accountsSql, usageParams),
    pool.query(errorsSql, errorParams),
  ]);

  const points = normalizeLatencyPoints(pointsRes.rows as RawLatencyPointRow[]);
  const buckets = points.map((point) => ({ bucket: point.bucket, label: point.label }));

  return {
    range,
    groupId,
    granularity,
    generatedAt: new Date().toISOString(),
    points,
    accounts: normalizeLatencyAccounts(accountsRes.rows as RawLatencyAccountRow[], buckets),
    errors: normalizeLatencyErrors(errorsRes.rows as RawLatencyErrorRow[], buckets),
  };
}

export async function getModelStats(
  pool: Pool,
  range: BoardRange,
  limit = 10,
  groupId: number | null = null,
  rosterNames: string[] = [],
): Promise<ModelStatsPayload> {
  const roster = activeRosterNames(rosterNames);
  const filter = usageGroupFilter(groupId, 3);
  const rosterFilter = usageRosterFilter(roster, 3 + filter.params.length);
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
      ${rosterFilter.clause}
    GROUP BY model
    HAVING COUNT(*) > 0
    ORDER BY tokens DESC, requests DESC, model ASC
    LIMIT $2
  `;

  const { rows } = await pool.query(sql, [
    appConfig.timezone,
    limit,
    ...filter.params,
    ...rosterFilter.params,
  ]);
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

export async function getAccountQuotas(
  pool: Pool,
  groupId: number | null = null,
): Promise<AccountQuotasPayload> {
  const filter = accountGroupFilter(groupId, 1);
  const sql = `
    WITH selected_accounts AS (
      SELECT a.id, a.name, a.status, a.last_used_at, a.extra,
             -- 只抽这两个键：credentials 里还有 token，绝不让它离开数据库
             NULLIF(a.credentials->>'plan_type', '') AS plan_type,
             NULLIF(a.credentials->>'subscription_expires_at', '') AS subscription_expires_at
      FROM accounts a
      WHERE a.deleted_at IS NULL
        AND a.platform = 'openai'
        AND a.type = 'oauth'
        -- 额度池只展示在用的号：状态异常或已关闭调度的账号不展示
        AND a.status = 'active'
        AND a.schedulable
        AND (
          a.extra ? 'codex_5h_used_percent'
          OR a.extra ? 'codex_7d_used_percent'
        )
        ${filter.clause}
    ),
    usage_5h AS (
      SELECT
        ul.account_id,
        COUNT(*) AS requests,
        ${TOKENS_SQL} AS tokens,
        ${ACCOUNT_COST_SQL} AS cost
      FROM usage_logs ul
      INNER JOIN selected_accounts sa ON sa.id = ul.account_id
      WHERE ul.created_at >= now() - interval '5 hours'
      GROUP BY ul.account_id
    ),
    usage_7d AS (
      SELECT
        ul.account_id,
        COUNT(*) AS requests,
        ${TOKENS_SQL} AS tokens,
        ${ACCOUNT_COST_SQL} AS cost
      FROM usage_logs ul
      INNER JOIN selected_accounts sa ON sa.id = ul.account_id
      WHERE ul.created_at >= now() - interval '7 days'
      GROUP BY ul.account_id
    )
    SELECT
      sa.id AS account_id,
      sa.name AS account_name,
      sa.status,
      sa.last_used_at,
      sa.extra,
      sa.plan_type,
      sa.subscription_expires_at,
      COALESCE(u5.requests, 0) AS requests_5h,
      COALESCE(u5.tokens, 0) AS tokens_5h,
      COALESCE(u5.cost, 0) AS cost_5h,
      COALESCE(u7.requests, 0) AS requests_7d,
      COALESCE(u7.tokens, 0) AS tokens_7d,
      COALESCE(u7.cost, 0) AS cost_7d
    FROM selected_accounts sa
    LEFT JOIN usage_5h u5 ON u5.account_id = sa.id
    LEFT JOIN usage_7d u7 ON u7.account_id = sa.id
    ORDER BY
      GREATEST(
        CASE
          WHEN COALESCE(sa.extra->>'codex_5h_used_percent', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN (sa.extra->>'codex_5h_used_percent')::numeric
          ELSE 0
        END,
        CASE
          WHEN COALESCE(sa.extra->>'codex_7d_used_percent', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN (sa.extra->>'codex_7d_used_percent')::numeric
          ELSE 0
        END
      ) DESC,
      COALESCE(u5.tokens, 0) DESC,
      sa.id ASC
    LIMIT 50
  `;

  const { rows } = await pool.query(sql, filter.params);
  const now = new Date();
  const mapped: AccountQuotaRow[] = rows
    .map((row) => {
      const extra = (row.extra ?? {}) as Record<string, unknown>;
      if (!hasCodexQuotaSnapshot(extra)) return null;

      const usageUpdatedAt = parseExtraDate(extra.codex_usage_updated_at);
      return {
        accountId: Number(row.account_id),
        accountName: String(row.account_name || ''),
        status: String(row.status || 'unknown'),
        lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
        usageUpdatedAt: usageUpdatedAt ? usageUpdatedAt.toISOString() : null,
        planType: row.plan_type ? String(row.plan_type) : null,
        subscriptionExpiresAt: row.subscription_expires_at
          ? String(row.subscription_expires_at)
          : null,
        fiveHour: parseCodexQuotaWindow(extra, '5h', now),
        sevenDay: parseCodexQuotaWindow(extra, '7d', now),
        requests5h: Number(row.requests_5h || 0),
        tokens5h: Number(row.tokens_5h || 0),
        cost5h: Number(row.cost_5h || 0),
        requests7d: Number(row.requests_7d || 0),
        tokens7d: Number(row.tokens_7d || 0),
        cost7d: Number(row.cost_7d || 0),
      } satisfies AccountQuotaRow;
    })
    .filter((row): row is AccountQuotaRow => row !== null);

  return {
    groupId,
    generatedAt: new Date().toISOString(),
    rows: mapped,
  };
}

/** 趋势查询需要回看的历史长度（天）：7 天窗口 + 余量 */
const QUOTA_HISTORY_DAYS = 9;

/**
 * Codex 7d 配额的消耗趋势与"够不够"推算。
 *
 * 两步查询：① 候选账号 + 上游快照的原始字段（credentials 只取 plan_type 一个键）；
 * ② 这些账号按小时聚合的 token 消耗（有界回看，命中 account_id+created_at 索引）。
 * 窗口边界与所有换算都交给纯函数（lib/quota-projection.ts），这里只负责取数和对齐。
 */
export async function getQuotaProjection(
  pool: Pool,
  groupId: number | null = null,
): Promise<QuotaProjectionPayload> {
  const now = new Date();
  const filter = accountGroupFilter(groupId, 1);

  const accountsSql = `
    SELECT
      a.id,
      a.name,
      a.extra->>'codex_7d_used_percent'   AS used_percent_raw,
      a.extra->>'codex_7d_reset_at'       AS reset_at_raw,
      a.extra->>'codex_7d_window_minutes' AS window_minutes_raw,
      a.extra->>'codex_usage_updated_at'  AS snapshot_at_raw,
      NULLIF(a.credentials->>'plan_type', '') AS plan_type
    FROM accounts a
    WHERE a.deleted_at IS NULL
      AND a.platform = 'openai'
      AND a.type = 'oauth'
      AND a.status = 'active'
      AND a.schedulable
      AND a.extra ? 'codex_7d_used_percent'
      ${filter.clause}
    ORDER BY a.id ASC
    LIMIT 50
  `;

  const { rows: accountRows } = await pool.query(accountsSql, filter.params);

  const accountIds = accountRows
    .map((row) => Number(row.id))
    .filter((id) => Number.isSafeInteger(id));

  const historySince = new Date(now.getTime() - QUOTA_HISTORY_DAYS * 86_400_000);
  const bucketsByAccount = new Map<number, QuotaProjectionBucket[]>();

  if (accountIds.length > 0) {
    const bucketsSql = `
      SELECT
        ul.account_id,
        (date_trunc('hour', ul.created_at AT TIME ZONE $1) AT TIME ZONE $1) AS bucket_at,
        TO_CHAR(date_trunc('hour', ul.created_at AT TIME ZONE $1), 'MM-DD HH24:00') AS label,
        ${TOKENS_SQL} AS tokens
      FROM usage_logs ul
      WHERE ul.account_id = ANY($2::bigint[])
        AND ul.created_at >= $3
      GROUP BY 1, 2, 3
      ORDER BY 1 ASC, 2 ASC
    `;
    const { rows } = await pool.query(bucketsSql, [
      appConfig.timezone,
      accountIds,
      historySince,
    ]);
    for (const row of rows) {
      const accountId = Number(row.account_id);
      const at = row.bucket_at ? new Date(row.bucket_at).getTime() : Number.NaN;
      if (!Number.isFinite(at)) continue;
      const list = bucketsByAccount.get(accountId) ?? [];
      list.push({
        ts: at,
        label: String(row.label ?? ''),
        tokens: Number(row.tokens || 0),
      });
      bucketsByAccount.set(accountId, list);
    }
  }

  const accounts: QuotaProjectionAccount[] = accountRows.map((row) => {
    const accountId = Number(row.id);
    const usedPercent = parseExtraNumber(row.used_percent_raw);
    const resetAt = parseExtraDate(row.reset_at_raw);
    const snapshotAt = parseExtraDate(row.snapshot_at_raw);
    const rawWindowMinutes = parseExtraNumber(row.window_minutes_raw);
    const windowMinutes =
      rawWindowMinutes !== null && rawWindowMinutes > 0 ? Math.round(rawWindowMinutes) : null;
    const windowStartMs =
      resetAt && windowMinutes ? resetAt.getTime() - windowMinutes * 60_000 : null;
    const all = bucketsByAccount.get(accountId) ?? [];
    // 只保留本账号窗口内、且不晚于快照的桶（桶按整点对齐，落点误差上限 1 小时）
    const buckets =
      windowStartMs === null || !snapshotAt
        ? all
        : all.filter((bucket) => bucket.ts >= windowStartMs && bucket.ts <= snapshotAt.getTime());

    return {
      accountId,
      accountName: String(row.name ?? ''),
      planType: row.plan_type ? String(row.plan_type) : null,
      usedPercent,
      resetAt: resetAt ? resetAt.toISOString() : null,
      windowStartAt: windowStartMs === null ? null : new Date(windowStartMs).toISOString(),
      snapshotAt: snapshotAt ? snapshotAt.toISOString() : null,
      windowMinutes,
      buckets,
    } satisfies QuotaProjectionAccount;
  });

  const views = buildQuotaProjections(accounts, now.getTime(), historySince.getTime());

  return {
    groupId,
    generatedAt: new Date().toISOString(),
    summary: summarizeVerdicts(views),
    views,
  };
}
