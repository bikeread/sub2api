import type { Pool } from 'pg';

import { appConfig } from '@/lib/config';
import type {
  AdoptionClientBreakdownRow,
  AdoptionClientType,
  AdoptionModelBreakdownRow,
  AdoptionPayload,
  AdoptionPersonRow,
  AdoptionStage,
  AdoptionSummary,
  AdoptionTrendPoint,
} from '@/lib/types';

export const ADOPTION_WINDOW_DAYS = 30;
export const EFFECTIVE_REQUESTS_THRESHOLD = 100;
export const EFFECTIVE_ACTIVE_DAYS_THRESHOLD = 5;
export const ADOPTION_DEFAULT_GROUP_NAME = '公司专用';

const CLIENT_LABELS_ZH: Record<AdoptionClientType, string> = {
  codex_tui: 'Codex TUI',
  codex_desktop: 'Codex Desktop',
  claude_code: 'Claude Code',
  other: '其他',
};

const CLIENT_LABELS_EN: Record<AdoptionClientType, string> = {
  codex_tui: 'Codex TUI',
  codex_desktop: 'Codex Desktop',
  claude_code: 'Claude Code',
  other: 'Other',
};

const STAGE_LABELS_ZH: Record<AdoptionStage, string> = {
  not_adopted: '未采用',
  light_adoption: '轻度采用',
  effective_use: '有效使用',
};

const STAGE_LABELS_EN: Record<AdoptionStage, string> = {
  not_adopted: 'Not Adopted',
  light_adoption: 'Light Adoption',
  effective_use: 'Effective Use',
};

const STAGE_ORDER: Record<AdoptionStage, number> = {
  not_adopted: 0,
  light_adoption: 1,
  effective_use: 2,
};

export type AdoptionLang = 'zh' | 'en';

export function parseAdoptionLang(raw: string | null): AdoptionLang {
  return raw && raw.startsWith('zh') ? 'zh' : 'en';
}

export function classifyAiCodingClient(userAgent: string | null): AdoptionClientType {
  const ua = (userAgent || '').toLowerCase();
  if (ua.includes('codex desktop')) return 'codex_desktop';
  if (ua.includes('codex')) return 'codex_tui';
  if (ua.includes('claude') && ua.includes('code')) return 'claude_code';
  return 'other';
}

export function clientLabel(client: AdoptionClientType, lang: AdoptionLang): string {
  return lang === 'zh' ? CLIENT_LABELS_ZH[client] : CLIENT_LABELS_EN[client];
}

export function stageLabel(stage: AdoptionStage, lang: AdoptionLang): string {
  return lang === 'zh' ? STAGE_LABELS_ZH[stage] : STAGE_LABELS_EN[stage];
}

export function classifyAdoptionStage(
  codingRequests: number,
  codingActiveDays: number,
): AdoptionStage {
  if (
    codingRequests >= EFFECTIVE_REQUESTS_THRESHOLD ||
    codingActiveDays >= EFFECTIVE_ACTIVE_DAYS_THRESHOLD
  ) {
    return 'effective_use';
  }
  if (codingRequests >= 1) return 'light_adoption';
  return 'not_adopted';
}

export function sortPersonRows(rows: AdoptionPersonRow[]): AdoptionPersonRow[] {
  return [...rows].sort((a, b) => {
    const stageDiff = STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
    if (stageDiff !== 0) return stageDiff;
    if (a.stage === 'not_adopted') {
      return a.personName.localeCompare(b.personName, 'zh-Hans');
    }
    if (b.codingRequests !== a.codingRequests) return b.codingRequests - a.codingRequests;
    return a.personName.localeCompare(b.personName, 'zh-Hans');
  });
}

export function buildSummary(
  personRows: AdoptionPersonRow[],
): AdoptionSummary {
  let adopted = 0;
  let effective = 0;
  let notAdopted = 0;
  let light = 0;
  let codingRequests = 0;
  let codingTokens = 0;
  let codingCost = 0;

  for (const person of personRows) {
    codingRequests += person.codingRequests;
    codingTokens += person.codingTokens;
    codingCost += person.codingCost;
    if (person.stage === 'effective_use') {
      effective += 1;
      adopted += 1;
    } else if (person.stage === 'light_adoption') {
      light += 1;
      adopted += 1;
    } else {
      notAdopted += 1;
    }
  }

  const total = personRows.length;
  return {
    totalPeople: total,
    adoptedPeople: adopted,
    effectivePeople: effective,
    notAdoptedPeople: notAdopted,
    lightAdoptionPeople: light,
    adoptionRate: total > 0 ? adopted / total : 0,
    effectiveRate: total > 0 ? effective / total : 0,
    codingRequests,
    codingTokens,
    codingCost,
  };
}

type ClientBreakdownKey = `${AdoptionClientType}`;

export function buildClientBreakdown(
  rows: Array<{ apiKeyId: number; userAgent: string | null; requests: number }>,
  lang: AdoptionLang,
): AdoptionClientBreakdownRow[] {
  const requestsByClient = new Map<ClientBreakdownKey, number>();
  const peopleByClient = new Map<ClientBreakdownKey, Set<number>>();

  for (const row of rows) {
    const client = classifyAiCodingClient(row.userAgent);
    const key: ClientBreakdownKey = client;
    requestsByClient.set(key, (requestsByClient.get(key) ?? 0) + row.requests);
    if (!peopleByClient.has(key)) peopleByClient.set(key, new Set());
    peopleByClient.get(key)!.add(row.apiKeyId);
  }

  const order: AdoptionClientType[] = ['codex_tui', 'codex_desktop', 'claude_code', 'other'];
  const result: AdoptionClientBreakdownRow[] = order
    .map((client) => {
      const key: ClientBreakdownKey = client;
      const requests = requestsByClient.get(key) ?? 0;
      const people = peopleByClient.get(key)?.size ?? 0;
      return {
        client,
        label: clientLabel(client, lang),
        people,
        requests,
      };
    })
    .filter((row) => row.requests > 0 || row.people > 0);

  return result.sort((a, b) => b.requests - a.requests || b.people - a.people);
}

export function buildModelBreakdown(
  rows: Array<{ apiKeyId: number; model: string; requests: number; tokens: number }>,
  limit = 5,
): AdoptionModelBreakdownRow[] {
  const requestsByModel = new Map<string, number>();
  const tokensByModel = new Map<string, number>();
  const peopleByModel = new Map<string, Set<number>>();

  for (const row of rows) {
    const model = row.model || 'unknown';
    requestsByModel.set(model, (requestsByModel.get(model) ?? 0) + row.requests);
    tokensByModel.set(model, (tokensByModel.get(model) ?? 0) + row.tokens);
    if (!peopleByModel.has(model)) peopleByModel.set(model, new Set());
    peopleByModel.get(model)!.add(row.apiKeyId);
  }

  const result: AdoptionModelBreakdownRow[] = [];
  for (const [model, requests] of requestsByModel) {
    result.push({
      model,
      people: peopleByModel.get(model)?.size ?? 0,
      requests,
      tokens: tokensByModel.get(model) ?? 0,
    });
  }

  return result
    .sort((a, b) => b.requests - a.requests || b.tokens - a.tokens || a.model.localeCompare(b.model))
    .slice(0, limit);
}

type DailyKeyRow = {
  day: string;
  apiKeyId: number | null;
  requests: number;
};

export function buildTrend(dailyRows: DailyKeyRow[]): AdoptionTrendPoint[] {
  const dayOrder: string[] = [];
  const requestsByDay = new Map<string, Map<number, number>>();

  for (const row of dailyRows) {
    if (!requestsByDay.has(row.day)) {
      requestsByDay.set(row.day, new Map());
      dayOrder.push(row.day);
    }
    if (row.apiKeyId !== null && row.requests > 0) {
      const bucket = requestsByDay.get(row.day)!;
      bucket.set(row.apiKeyId, (bucket.get(row.apiKeyId) ?? 0) + row.requests);
    }
  }

  const cumulativeRequests = new Map<number, number>();
  const cumulativeActiveDays = new Map<number, Set<string>>();
  const points: AdoptionTrendPoint[] = [];

  for (const day of dayOrder) {
    const bucket = requestsByDay.get(day)!;
    for (const [apiKeyId, requests] of bucket) {
      cumulativeRequests.set(apiKeyId, (cumulativeRequests.get(apiKeyId) ?? 0) + requests);
      if (!cumulativeActiveDays.has(apiKeyId)) cumulativeActiveDays.set(apiKeyId, new Set());
      cumulativeActiveDays.get(apiKeyId)!.add(day);
    }

    let adoptedPeople = 0;
    let effectivePeople = 0;
    for (const [apiKeyId, requests] of cumulativeRequests) {
      if (requests < 1) continue;
      adoptedPeople += 1;
      const activeDays = cumulativeActiveDays.get(apiKeyId)?.size ?? 0;
      if (
        requests >= EFFECTIVE_REQUESTS_THRESHOLD ||
        activeDays >= EFFECTIVE_ACTIVE_DAYS_THRESHOLD
      ) {
        effectivePeople += 1;
      }
    }

    points.push({ day, adoptedPeople, effectivePeople });
  }

  return points;
}

function computeBounds(): { startAt: Date; endAt: Date } {
  const endAt = new Date();
  const startAt = new Date(endAt.getTime() - ADOPTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { startAt, endAt };
}

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

type PersonAggregateRow = {
  api_key_id: string | number;
  person_name: string | null;
  coding_requests: string | number;
  coding_active_days: string | number;
  coding_tokens: string | number;
  coding_cost: string | number;
  last_coding_at: Date | null;
};

type PersonClientRow = {
  api_key_id: string | number;
  user_agent: string | null;
  inbound_endpoint: string | null;
  requests: string | number;
};

type PersonModelRow = {
  api_key_id: string | number;
  model: string | null;
  requests: string | number;
  tokens: string | number;
};

type DailyKeyRowDb = {
  day: string;
  api_key_id: string | number | null;
  requests: string | number;
};

const AI_CODING_CONDITION_SQL = `(
  lower(coalesce(ul.user_agent, '')) LIKE '%codex%'
  OR lower(coalesce(ul.user_agent, '')) LIKE '%claude%code%'
  OR lower(coalesce(ul.inbound_endpoint, '')) LIKE '/backend-api/codex%'
)`;

const TOKENS_SQL =
  'ul.input_tokens + ul.output_tokens + ul.cache_creation_tokens + ul.cache_read_tokens';

const COST_SQL =
  'COALESCE(ul.account_stats_cost, ul.total_cost) * COALESCE(ul.account_rate_multiplier, 1)';

const MODEL_SQL = "COALESCE(NULLIF(ul.requested_model, ''), ul.model, ul.upstream_model, 'unknown')";

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchPersonAggregates(
  pool: Pool,
  startAt: Date,
  endAt: Date,
  groupId: number | null,
  rosterNames: string[] | null,
): Promise<PersonAggregateRow[]> {
  const params = rosterNames
    ? [startAt, endAt, appConfig.timezone, groupId, rosterNames]
    : [startAt, endAt, appConfig.timezone, groupId];
  const sql = `
    WITH key_base AS (
      SELECT ak.id, ak.name
      FROM api_keys ak
      WHERE ak.deleted_at IS NULL
        AND ak.status = 'active'
        AND ($4::bigint IS NULL OR ak.group_id = $4::bigint)
        ${rosterNames ? 'AND ak.name = ANY($5::text[])' : ''}
    ),
    coding_usage AS (
      SELECT ul.api_key_id, ul.created_at,
             ${TOKENS_SQL} AS tokens,
             ${COST_SQL} AS cost
      FROM usage_logs ul
      WHERE ul.created_at >= $1
        AND ul.created_at < $2
        AND ($4::bigint IS NULL OR ul.group_id = $4::bigint)
        AND ${AI_CODING_CONDITION_SQL}
    )
    SELECT
      kb.id AS api_key_id,
      kb.name AS person_name,
      COALESCE(COUNT(cu.*), 0) AS coding_requests,
      COALESCE(COUNT(DISTINCT (cu.created_at AT TIME ZONE $3)::date), 0) AS coding_active_days,
      COALESCE(SUM(cu.tokens), 0) AS coding_tokens,
      COALESCE(SUM(cu.cost), 0) AS coding_cost,
      MAX(cu.created_at) AS last_coding_at
    FROM key_base kb
    LEFT JOIN coding_usage cu ON cu.api_key_id = kb.id
    GROUP BY kb.id, kb.name
    ORDER BY kb.id ASC
  `;
  const { rows } = await pool.query(sql, params);
  return rows as PersonAggregateRow[];
}

async function fetchPersonClientRows(
  pool: Pool,
  startAt: Date,
  endAt: Date,
  groupId: number | null,
  rosterKeyIds: number[] | null,
): Promise<PersonClientRow[]> {
  const sql = `
    SELECT
      ul.api_key_id,
      ul.user_agent,
      ul.inbound_endpoint,
      COUNT(*) AS requests
    FROM usage_logs ul
    WHERE ul.created_at >= $1
      AND ul.created_at < $2
      AND ($3::bigint IS NULL OR ul.group_id = $3::bigint)
      ${rosterKeyIds ? 'AND ul.api_key_id = ANY($4::bigint[])' : ''}
      AND ${AI_CODING_CONDITION_SQL}
    GROUP BY ul.api_key_id, ul.user_agent, ul.inbound_endpoint
  `;
  const params = rosterKeyIds
    ? [startAt, endAt, groupId, rosterKeyIds]
    : [startAt, endAt, groupId];
  const { rows } = await pool.query(sql, params);
  return rows as PersonClientRow[];
}

async function fetchPersonModelRows(
  pool: Pool,
  startAt: Date,
  endAt: Date,
  groupId: number | null,
  rosterKeyIds: number[] | null,
): Promise<PersonModelRow[]> {
  const sql = `
    WITH coding_rows AS (
      SELECT
        ul.api_key_id,
        ${MODEL_SQL} AS model,
        ${TOKENS_SQL} AS tokens
      FROM usage_logs ul
      WHERE ul.created_at >= $1
        AND ul.created_at < $2
        AND ($3::bigint IS NULL OR ul.group_id = $3::bigint)
        ${rosterKeyIds ? 'AND ul.api_key_id = ANY($4::bigint[])' : ''}
        AND ${AI_CODING_CONDITION_SQL}
    )
    SELECT
      api_key_id,
      model,
      COUNT(*) AS requests,
      COALESCE(SUM(tokens), 0) AS tokens
    FROM coding_rows
    GROUP BY api_key_id, model
  `;
  const params = rosterKeyIds
    ? [startAt, endAt, groupId, rosterKeyIds]
    : [startAt, endAt, groupId];
  const { rows } = await pool.query(sql, params);
  return rows as PersonModelRow[];
}

async function fetchDailyKeyCounts(
  pool: Pool,
  startAt: Date,
  endAt: Date,
  groupId: number | null,
  rosterKeyIds: number[] | null,
): Promise<DailyKeyRowDb[]> {
  const sql = `
    WITH day_grid AS (
      SELECT generate_series(
        ($1::timestamptz AT TIME ZONE $3)::date,
        ($2::timestamptz AT TIME ZONE $3)::date,
        interval '1 day'
      )::date AS day_local
    ),
    daily_coding AS (
      SELECT
        (ul.created_at AT TIME ZONE $3)::date AS day_local,
        ul.api_key_id,
        COUNT(*) AS requests
      FROM usage_logs ul
      WHERE ul.created_at >= $1
        AND ul.created_at < $2
        AND ($4::bigint IS NULL OR ul.group_id = $4::bigint)
        ${rosterKeyIds ? 'AND ul.api_key_id = ANY($5::bigint[])' : ''}
        AND ${AI_CODING_CONDITION_SQL}
      GROUP BY day_local, ul.api_key_id
    )
    SELECT
      dg.day_local::text AS day,
      dc.api_key_id,
      COALESCE(dc.requests, 0) AS requests
    FROM day_grid dg
    LEFT JOIN daily_coding dc ON dc.day_local = dg.day_local
    ORDER BY dg.day_local ASC, dc.api_key_id ASC
  `;
  const params = rosterKeyIds
    ? [startAt, endAt, appConfig.timezone, groupId, rosterKeyIds]
    : [startAt, endAt, appConfig.timezone, groupId];
  const { rows } = await pool.query(sql, params);
  return rows as DailyKeyRowDb[];
}

async function fetchRosterKeyIds(
  pool: Pool,
  rosterNames: string[] | null,
  groupId: number | null,
): Promise<number[] | null> {
  if (!rosterNames) return null;
  const { rows } = await pool.query(
    `SELECT id
     FROM api_keys
     WHERE deleted_at IS NULL
       AND status = 'active'
       AND name = ANY($1::text[])
       AND ($2::bigint IS NULL OR group_id = $2::bigint)`,
    [rosterNames, groupId],
  );
  return rows.map((row) => Number(row.id));
}

async function fetchGroupName(
  pool: Pool,
  groupId: number | null,
): Promise<string | null> {
  if (groupId === null) return null;
  const { rows } = await pool.query(
    `SELECT name FROM groups WHERE id = $1 AND deleted_at IS NULL`,
    [groupId],
  );
  return rows[0]?.name ? String(rows[0].name) : null;
}

function buildPersonRows(
  aggregates: PersonAggregateRow[],
  clientRows: PersonClientRow[],
  modelRows: PersonModelRow[],
  lang: AdoptionLang,
): AdoptionPersonRow[] {
  const requestsByPersonClient = new Map<number, Map<AdoptionClientType, number>>();
  for (const row of clientRows) {
    const apiKeyId = Number(row.api_key_id);
    const client = classifyAiCodingClient(row.user_agent);
    if (!requestsByPersonClient.has(apiKeyId)) {
      requestsByPersonClient.set(apiKeyId, new Map());
    }
    const bucket = requestsByPersonClient.get(apiKeyId)!;
    bucket.set(client, (bucket.get(client) ?? 0) + toNumber(row.requests));
  }

  const requestsByPersonModel = new Map<number, Map<string, number>>();
  for (const row of modelRows) {
    const apiKeyId = Number(row.api_key_id);
    const model = String(row.model || 'unknown');
    if (!requestsByPersonModel.has(apiKeyId)) {
      requestsByPersonModel.set(apiKeyId, new Map());
    }
    const bucket = requestsByPersonModel.get(apiKeyId)!;
    bucket.set(model, (bucket.get(model) ?? 0) + toNumber(row.requests));
  }

  return aggregates.map((row) => {
    const apiKeyId = Number(row.api_key_id);
    const personName = String(row.person_name || `key-${apiKeyId}`);
    const codingRequests = toNumber(row.coding_requests);
    const codingActiveDays = toNumber(row.coding_active_days);
    const codingTokens = toNumber(row.coding_tokens);
    const codingCost = toNumber(row.coding_cost);
    const lastCodingAt = row.last_coding_at ? new Date(row.last_coding_at).toISOString() : null;
    const stage = classifyAdoptionStage(codingRequests, codingActiveDays);

    const clientBucket = requestsByPersonClient.get(apiKeyId);
    let primaryClient: AdoptionClientType = 'other';
    if (clientBucket && codingRequests > 0) {
      let bestClient: AdoptionClientType = 'other';
      let bestRequests = -1;
      for (const [client, requests] of clientBucket) {
        if (
          requests > bestRequests ||
          (requests === bestRequests && client < bestClient)
        ) {
          bestClient = client;
          bestRequests = requests;
        }
      }
      primaryClient = bestClient;
    }
    const primaryClientLabel = codingRequests > 0 ? clientLabel(primaryClient, lang) : '-';

    const modelBucket = requestsByPersonModel.get(apiKeyId);
    let primaryModel: string | null = null;
    if (modelBucket && codingRequests > 0) {
      let bestModel: string | null = null;
      let bestRequests = -1;
      for (const [model, requests] of modelBucket) {
        if (
          requests > bestRequests ||
          (requests === bestRequests && bestModel !== null && model < bestModel)
        ) {
          bestModel = model;
          bestRequests = requests;
        }
      }
      primaryModel = bestModel;
    }

    return {
      apiKeyId,
      personName,
      stage,
      codingRequests,
      codingActiveDays,
      codingTokens,
      codingCost,
      lastCodingAt,
      primaryClient,
      primaryClientLabel,
      primaryModel,
    };
  });
}

export function buildCustomRosterRows(
  rosterNames: string[] | null,
  personRows: AdoptionPersonRow[],
): AdoptionPersonRow[] {
  if (!rosterNames) return [];
  const keyNames = new Set(personRows.map((person) => person.personName));
  return rosterNames
    .filter((name) => !keyNames.has(name))
    .map((personName, index) => ({
      apiKeyId: -(index + 1),
      personName,
      stage: 'not_adopted',
      codingRequests: 0,
      codingActiveDays: 0,
      codingTokens: 0,
      codingCost: 0,
      lastCodingAt: null,
      primaryClient: 'other',
      primaryClientLabel: '-',
      primaryModel: null,
    }));
}

export async function getAdoption(
  pool: Pool,
  groupId: number | null = null,
  lang: AdoptionLang = 'zh',
  rosterNames: string[] = [],
): Promise<AdoptionPayload> {
  const { startAt, endAt } = computeBounds();
  const roster = rosterNames.length > 0 ? rosterNames : null;
  const rosterKeyIds = await fetchRosterKeyIds(pool, roster, groupId);

  const [aggregates, clientRows, modelRows, dailyRows, groupName] = await Promise.all([
    fetchPersonAggregates(pool, startAt, endAt, groupId, roster),
    fetchPersonClientRows(pool, startAt, endAt, groupId, rosterKeyIds),
    fetchPersonModelRows(pool, startAt, endAt, groupId, rosterKeyIds),
    fetchDailyKeyCounts(pool, startAt, endAt, groupId, rosterKeyIds),
    fetchGroupName(pool, groupId),
  ]);

  const keyedPeople = buildPersonRows(aggregates, clientRows, modelRows, lang);
  const personRows = sortPersonRows([
    ...keyedPeople,
    ...buildCustomRosterRows(roster, keyedPeople),
  ]);
  const summary = buildSummary(personRows);
  const trend = buildTrend(
    dailyRows.map((row) => ({
      day: String(row.day),
      apiKeyId:
        row.api_key_id === null || row.api_key_id === undefined
          ? null
          : Number(row.api_key_id),
      requests: toNumber(row.requests),
    })),
  );
  const clients = buildClientBreakdown(
    clientRows.map((row) => ({
      apiKeyId: Number(row.api_key_id),
      userAgent: row.user_agent,
      requests: toNumber(row.requests),
    })),
    lang,
  );
  const models = buildModelBreakdown(
    modelRows.map((row) => ({
      apiKeyId: Number(row.api_key_id),
      model: String(row.model || 'unknown'),
      requests: toNumber(row.requests),
      tokens: toNumber(row.tokens),
    })),
  );

  return {
    groupId,
    groupName,
    timezone: appConfig.timezone,
    windowDays: ADOPTION_WINDOW_DAYS,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    generatedAt: new Date().toISOString(),
    rosterActive: roster !== null,
    rosterTotal: roster?.length ?? 0,
    summary,
    trend,
    clients,
    models,
    people: personRows,
  };
}
