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
  totalKeys: number;
  activeKeys: number;
  usedKeys: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  totalRequests: number;
  cacheHitRate: number | null;
  averageDurationMs: number;
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
  apiKeyId: number;
  keyName: string;
  points: TrendPoint[];
}

export interface TrendPayload {
  range: BoardRange;
  groupId: number | null;
  granularity: 'hour' | 'day';
  generatedAt: string;
  total: TrendPoint[];
  topKeys: TrendSeries[];
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
