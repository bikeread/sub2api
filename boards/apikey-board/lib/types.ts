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
  planType: string | null;
  subscriptionExpiresAt: string | null;
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

/** Codex 7d 配额的消耗趋势/预测：服务端只给原始事实，换算与判定在 lib/quota-projection.ts 里算。 */
export interface QuotaProjectionBucket {
  /** 桶起点（绝对毫秒，已按 Board 时区对齐） */
  ts: number;
  /** 展示用标签，如 09-18 16:00 */
  label: string;
  /** 该小时内消耗的 token（已按快照时刻截断） */
  tokens: number;
}

export interface QuotaProjectionAccount {
  accountId: number;
  accountName: string;
  planType: string | null;
  usedPercent: number | null;
  resetAt: string | null;
  windowStartAt: string | null;
  snapshotAt: string | null;
  windowMinutes: number | null;
  buckets: QuotaProjectionBucket[];
}

export interface QuotaProjectionPayload {
  groupId: number | null;
  generatedAt: string;
  summary: Record<QuotaVerdict, number>;
  views: QuotaProjectionView[];
}

export type QuotaVerdict = 'enough' | 'tight' | 'not-enough' | 'uncertain' | 'unknown';

export type QuotaProjectionState =
  | 'ok'
  | 'no-window'
  | 'no-snapshot'
  | 'stale-snapshot'
  | 'window-not-started'
  | 'truncated'
  | 'quiet'
  | 'no-usage'
  | 'rate-unavailable';

export type QuotaCalibration = 'ok' | 'coarse' | 'unavailable';

export interface QuotaHistoryPoint {
  ts: number;
  /** 估算的累计使用百分比（已裁剪到 100） */
  percent: number;
  tokens: number;
}

export interface QuotaForecastPoint {
  ts: number;
  percent: number;
}

export interface QuotaPercentBand {
  min: number;
  max: number;
}

/** 一个账号的 Codex 配额消耗曲线 + 预测（由 lib/quota-projection.ts 纯函数算出） */
export interface QuotaProjectionView {
  accountId: number;
  accountName: string;
  planType: string | null;
  state: QuotaProjectionState;
  verdict: QuotaVerdict;
  calibration: QuotaCalibration;
  /** 上游原始百分比（未经"重置后归零"处理） */
  usedPercent: number | null;
  resetAtMs: number | null;
  windowStartMs: number | null;
  snapshotMs: number | null;
  windowMinutes: number | null;
  tokensInWindow: number;
  tokensPerPercent: number | null;
  tokensPerPercentBand: { min: number; max: number } | null;
  /** 估算速率：百分点/小时 */
  ratePerHour: number;
  /** 速率口径：回看了多少小时 */
  lookbackHours: number;
  rateSpanStartMs: number | null;
  percentAtReset: number | null;
  percentAtResetBand: QuotaPercentBand | null;
  /** 预计达到 100% 的时刻 */
  exhaustAtMs: number | null;
  history: QuotaHistoryPoint[];
  /** 预测段：只两个点（快照点 → min(重置, 耗尽)），前端画一条虚线 */
  forecast: QuotaForecastPoint[];
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
