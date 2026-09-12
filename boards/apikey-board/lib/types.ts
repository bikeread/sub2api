export type BoardRange = 'today' | '7d';

export interface AdminIdentity {
  id: number;
  email: string;
  username?: string;
  role: string;
}

export interface SummaryPayload {
  range: BoardRange;
  groupId: number | null;
  timezone: string;
  generatedAt: string;
  rosterActive: boolean;
  rosterTotal: number;
  totalKeys: number;
  activeKeys: number;
  usedKeys: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  totalRequests: number;
  cacheHitRate: number | null;
  averageFirstTokenMs: number;
  maxFirstTokenMs: number | null;
  slowRequestCount: number;
}

export interface RankingRow {
  apiKeyId: number;
  keyName: string;
  status: string;
  lastUsedAt: string | null;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  tokens: number;
  cacheHitRate: number | null;
  averageDurationMs: number | null;
}

export interface RankingPayload {
  range: BoardRange;
  groupId: number | null;
  generatedAt: string;
  rows: RankingRow[];
}

export interface TrendPoint {
  bucket: string;
  label: string;
  requests: number;
  tokens: number;
}

export interface TrendSeries {
  groupId: number | null;
  groupName: string;
  points: TrendPoint[];
}

export interface TrendPayload {
  range: BoardRange;
  groupId: number | null;
  granularity: 'hour' | 'day';
  generatedAt: string;
  groups: TrendSeries[];
}

export interface LatencyHealthPoint {
  bucket: string;
  label: string;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  slowCount: number;
  requests: number;
}

export interface LatencyAccountPoint {
  bucket: string;
  label: string;
  p95: number | null;
  requests: number;
}

export interface LatencyAccountSeries {
  accountId: number | null;
  accountName: string;
  points: LatencyAccountPoint[];
}

export interface LatencyErrorEvent {
  at: string;
  accountId: number | null;
  statusCode: number;
  latencyMs: number;
}

export interface LatencyErrorGroup {
  bucket: string;
  label: string;
  count: number;
  events: LatencyErrorEvent[];
}

export interface LatencyHealthPayload {
  range: BoardRange;
  groupId: number | null;
  granularity: 'hour' | 'day';
  generatedAt: string;
  points: LatencyHealthPoint[];
  accounts: LatencyAccountSeries[];
  errors: LatencyErrorGroup[];
}

export interface OpenAIStatusPayload {
  indicator: string;
  description: string;
  fetchedAt: string;
}

export interface ModelStatsRow {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  tokens: number;
  cacheHitRate: number | null;
  averageDurationMs: number | null;
}

export interface ModelStatsPayload {
  range: BoardRange;
  groupId: number | null;
  generatedAt: string;
  rows: ModelStatsRow[];
}

export interface AccountQuotaWindow {
  usedPercent: number | null;
  resetAt: string | null;
}

export interface AccountQuotaRow {
  accountId: number;
  accountName: string;
  status: string;
  lastUsedAt: string | null;
  usageUpdatedAt: string | null;
  fiveHour: AccountQuotaWindow;
  sevenDay: AccountQuotaWindow;
  requests5h: number;
  tokens5h: number;
  cost5h: number;
  requests7d: number;
  tokens7d: number;
  cost7d: number;
}

export interface AccountQuotasPayload {
  groupId: number | null;
  generatedAt: string;
  rows: AccountQuotaRow[];
}

export interface GroupOption {
  id: number;
  name: string;
  platform: string;
  status: string;
  sortOrder: number;
}

export interface GroupsPayload {
  generatedAt: string;
  rows: GroupOption[];
}

export interface Sub2APISuccessEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export type BoardView = 'overview' | 'adoption';

export type AdoptionStage = 'not_adopted' | 'light_adoption' | 'effective_use';

export type AdoptionClientType = 'codex_tui' | 'codex_desktop' | 'claude_code' | 'other';

export interface AdoptionSummary {
  totalPeople: number;
  adoptedPeople: number;
  effectivePeople: number;
  notAdoptedPeople: number;
  lightAdoptionPeople: number;
  adoptionRate: number;
  effectiveRate: number;
  codingRequests: number;
  codingTokens: number;
  codingCost: number;
}

export interface AdoptionPersonRow {
  apiKeyId: number;
  personName: string;
  stage: AdoptionStage;
  codingRequests: number;
  codingActiveDays: number;
  codingTokens: number;
  codingCost: number;
  lastCodingAt: string | null;
  primaryClient: AdoptionClientType;
  primaryClientLabel: string;
  primaryModel: string | null;
}

export interface AdoptionTrendPoint {
  day: string;
  adoptedPeople: number;
  effectivePeople: number;
}

export interface AdoptionClientBreakdownRow {
  client: AdoptionClientType;
  label: string;
  people: number;
  requests: number;
}

export interface AdoptionModelBreakdownRow {
  model: string;
  people: number;
  requests: number;
  tokens: number;
}

export interface AdoptionPayload {
  groupId: number | null;
  groupName: string | null;
  timezone: string;
  windowDays: number;
  startAt: string;
  endAt: string;
  generatedAt: string;
  rosterActive: boolean;
  rosterTotal: number;
  summary: AdoptionSummary;
  trend: AdoptionTrendPoint[];
  clients: AdoptionClientBreakdownRow[];
  models: AdoptionModelBreakdownRow[];
  people: AdoptionPersonRow[];
}

export interface RosterKeyOption {
  id: number;
  name: string;
  inRoster: boolean;
}

export interface RosterPayload {
  names: string[];
  availableKeys: RosterKeyOption[];
  updatedAt?: string | null;
  groupId?: number | null;
}
