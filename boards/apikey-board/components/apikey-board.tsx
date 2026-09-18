'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import {
  ADOPTION_DEFAULT_GROUP_NAME,
  ADOPTION_WINDOW_DAYS,
  clientLabel,
  stageLabel,
  type AdoptionLang,
} from '@/lib/adoption';
import { appConfig } from '@/lib/config';
import { parseSubscriptionExpiry, planTypeLabel } from '@/lib/account-quotas';
import { formatAbsoluteMinute, formatInteger, formatResetTime } from '@/lib/format';
import { formatLatencyValue } from '@/lib/latency-chart';
import { rangeLabel } from '@/lib/range';
import { QuotaProjectionChart } from '@/components/quota-projection-chart';
import type {
  AccountQuotaRow,
  AccountQuotasPayload,
  AdoptionClientType,
  AdoptionPayload,
  AdoptionPersonRow,
  AdoptionStage,
  AdoptionTrendPoint,
  BoardRange,
  BoardView,
  GroupsPayload,
  GroupOption,
  ModelStatsPayload,
  OpenAIStatusPayload,
  QuotaProjectionPayload,
  RankingPayload,
  RosterKeyOption,
  RosterPayload,
  SummaryPayload,
} from '@/lib/types';

type BoardData = {
  summary: SummaryPayload;
  accountQuotas: AccountQuotasPayload;
  quotaProjection: QuotaProjectionPayload;
  ranking: RankingPayload;
  models: ModelStatsPayload;
  openaiStatus: OpenAIStatusPayload;
};

type DataState<T> =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: T; refreshedAt: string };

type ViewState = DataState<BoardData>;

const TOKEN_STORAGE_KEY = 'apikey-board:admin-token';
const GROUP_STORAGE_KEY = 'apikey-board:group-id';

function readLang(raw: string | null): 'zh' | 'en' {
  return raw?.startsWith('zh') ? 'zh' : 'en';
}

function readTheme(raw: string | null): 'dark' | 'light' {
  return raw === 'light' ? 'light' : 'dark';
}

function copyFor(lang: 'zh' | 'en') {
  return {
    zh: {
      title: 'API Key 团队大屏',
      subtitle: '按密钥名称展示团队内部调用量、Token 消耗与模型分布。',
      today: '今日累计',
      last7d: '最近7天',
      loading: '正在加载看板数据…',
      unauthorized: '无法访问大屏，请从 Sub2API 管理后台重新进入。',
      retry: '重试',
      requests: '请求总数',
      inputToken: '输入 TOKEN',
      cacheHitToken: '缓存命中 TOKEN',
      outputToken: '输出 TOKEN',
      cacheHitRate: '命中率',
      activeKeys: '活跃 Key',
      totalKeys: '总 Key 数',
      usedKeys: '有消耗 Key',
      avgTtft: '平均 TTFT',
      totalTokens: '总 Token',
      latencyHealth: '延迟与健康',
      latencyHealthHint: 'TTFT 分位数（p50/p95/p99）、慢请求与上游错误',
      maxTtft: '最慢 TTFT',
      slowCount: '慢请求数',
      slowLabel: '慢请求',
      p50Label: 'p50',
      p95Label: 'p95',
      p99Label: 'p99',
      errorMarkersLabel: '上游错误',
      tokenLabel: 'Token',
      openaiStatus: 'OpenAI 官方状态',
      statusNone: '正常运行',
      statusMinor: '部分降级',
      statusMajor: '重大故障',
      keyStats: '密钥统计',
      keyStatsHint: '按密钥名称查看请求量与 Token 消耗',
      accountQuotas: '账号额度池',
      accountQuotasHint: '上游 OpenAI OAuth 账号的 Codex 5h / 7d 快照',
      accountQuotasEmpty: '当前分组没有可展示的 Codex 额度快照',
      subscriptionUntil: '订阅到期',
      subscriptionMissing: '—',
      subscriptionStaleTag: '快照',
      subscriptionStaleHint: '该日期早于当前时间，上游快照尚未刷新；账号通常仍可正常使用',
      quotaForecast: '额度够不够',
      quotaForecastHint: '按当前消耗速度外推：7d 额度能否撑到重置时刻（估算）',
      forecastNoData: '暂无可推算的账号（窗口刚开始或缺少配额快照）',
      forecastObserved: '实测',
      forecastProjected: '外推',
      forecastCeiling: '100% 额度上限',
      forecastResetMarker: '重置时刻',
      forecastNowMarker: '现在',
      forecastEstimation: '估算口径：上游只给整数百分比、缓存 token 可能被打折，曲线按 token 折算',
      forecastRate: '速率',
      forecastPerPercent: '约',
      forecastExhaustEstimate: '预计',
      forecastAtResetEstimate: '到重置约',
      verdictEnough: '够',
      verdictTight: '偏紧',
      verdictNotEnough: '不够',
      verdictUncertain: '不确定',
      verdictUnknown: '无法判断',
      stateNoWindow: '上游未提供窗口时长',
      stateNoSnapshot: '缺少配额快照',
      stateStaleSnapshot: '快照已过重置时刻，等待上游刷新',
      stateWindowNotStarted: '窗口刚开始，数据不足',
      stateTruncated: '窗口起始早于可查历史',
      stateQuiet: '窗口内暂无消耗',
      stateNoUsage: '窗口内无消耗记录',
      stateRateUnavailable: '近期无消耗，无法推算速率',
      currentGroupAccount: '当前分组上游账号',
      currentGroupAccountHint: '该分组当前使用的 OpenAI OAuth 账号额度状态',
      accountName: '账号',
      fiveHourQuota: '5h 使用率',
      sevenDayQuota: '7d 使用率',
      resetAt: '重置',
      snapshotAt: '快照',
      recent5h: '近 5h',
      recent7d: '近 7d',
      modelStats: '模型统计',
      modelStatsHint: '按模型查看调用量与 Token 消耗',
      keyName: '密钥名称',
      modelName: '模型',
      status: '状态',
      requestsShort: '请求数',
      inputShort: '输入',
      outputShort: '输出',
      cacheHitShort: '命中',
      latencyShort: '延迟',
      refreshedAt: '刷新于',
      timezone: '时区',
      refreshEvery: '刷新间隔',
      groupFilter: '分组',
      allGroups: '全部分组',
      groupsUnavailable: '分组加载失败',
      noData: '当前时间窗口内没有可展示的数据',
      seconds: '秒',
      statusActive: '正常',
      statusDisabled: '停用',
      statusExpired: '过期',
      statusQuota: '额度耗尽',
      statusUnknown: '未知',
      tabOverview: 'Token 概览',
      tabAdoption: 'AI Coding 采用',
      adoptionTitle: 'AI Coding 采用',
      adoptionSubtitle: '最近 30 天滚动窗口，人员名称来自 API Key 名称。',
      adoptionThreshold: '有效使用：≥100 次 AI Coding 请求，或 ≥5 个 AI Coding 活跃天。',
      adoptionRate: '采用率',
      effectiveRate: '有效使用率',
      adoptedPeople: '采用人数',
      effectivePeople: '有效使用人数',
      notAdoptedPeople: '未采用人数',
      lightAdoptionPeople: '轻度采用人数',
      notAdopted: '未采用',
      lightAdoption: '轻度采用',
      effectiveUse: '有效使用',
      codingRequests: 'AI Coding 请求数',
      codingTokens: 'AI Coding Token',
      codingCost: 'AI Coding 成本',
      last30d: '最近 30 天',
      adoptionTrend: '每日采用趋势',
      adoptionTrendHint: '累计采用人数与有效使用人数（最近 30 天）',
      clientBreakdown: '客户端分布',
      modelBreakdown: '模型 Top 5',
      primaryClient: '主要客户端',
      primaryModel: '主要模型',
      personName: '姓名',
      stage: '状态',
      codingActiveDays: 'Coding 活跃天数',
      lastCodingAt: '最近 Coding 使用',
      personTableTitle: '人员明细',
      personTableHint: '按治理优先级排序：未采用 → 轻度采用 → 有效使用',
      people: '人数',
      totalPeople: '总人数',
      rosterScope: '团队名单',
      rosterManage: '名单管理',
      rosterActive: '名单已启用',
      rosterInactive: '名单未配置',
      rosterTitle: '团队名单管理',
      rosterHint: '勾选要纳入统计的 API Key，也可手动添加不在列表中的人员',
      rosterAvailableKeys: '当前分组可用 Key',
      rosterCustomNames: '自定义人员（名单内有但无 Key）',
      rosterCustomPlaceholder: '输入姓名后回车添加',
      rosterAddCustom: '添加',
      rosterSave: '保存名单',
      rosterCancel: '取消',
      rosterSaving: '保存中…',
      rosterLoadError: '名单加载失败',
      rosterSaveError: '名单保存失败',
      rosterCount: '已选 {n} 人',
      rosterClearAll: '清空',
      rosterSelectAll: '全选',
      rosterNoKey: '无 Key',
      close: '关闭',
    },
    en: {
      title: 'API Key Wallboard',
      subtitle: 'Key-name-first board for internal team usage, tokens, and model distribution.',
      today: 'Today',
      last7d: 'Last 7 Days',
      loading: 'Loading the wallboard…',
      unauthorized: 'Unable to access the board. Re-open it from the Sub2API admin console.',
      retry: 'Retry',
      requests: 'Requests',
      inputToken: 'Input Tokens',
      cacheHitToken: 'Cache Hit Tokens',
      outputToken: 'Output Tokens',
      cacheHitRate: 'Hit Rate',
      activeKeys: 'Active Keys',
      totalKeys: 'Total Keys',
      usedKeys: 'Used Keys',
      avgTtft: 'Avg TTFT',
      totalTokens: 'Total Tokens',
      latencyHealth: 'Latency & Health',
      latencyHealthHint: 'TTFT percentiles (p50/p95/p99), slow requests and upstream errors',
      maxTtft: 'Max TTFT',
      slowCount: 'Slow Reqs',
      slowLabel: 'Slow',
      p50Label: 'p50',
      p95Label: 'p95',
      p99Label: 'p99',
      errorMarkersLabel: 'Upstream errors',
      tokenLabel: 'Token',
      openaiStatus: 'OpenAI Status',
      statusNone: 'Operational',
      statusMinor: 'Partial Degradation',
      statusMajor: 'Major Outage',
      keyStats: 'Key Stats',
      keyStatsHint: 'Request volume and token usage by API key name',
      accountQuotas: 'Account Quota Pool',
      accountQuotasHint: 'Codex 5h / 7d snapshots for upstream OpenAI OAuth accounts',
      accountQuotasEmpty: 'No Codex quota snapshots for the selected group',
      subscriptionUntil: 'Subscription until',
      subscriptionMissing: '—',
      subscriptionStaleTag: 'snapshot',
      subscriptionStaleHint: 'This date is in the past and the upstream snapshot has not refreshed; the account usually still works',
      quotaForecast: 'Will the quota last?',
      quotaForecastHint: 'Extrapolating the current burn rate: can the 7d quota last until the reset (estimate)',
      forecastNoData: 'No account can be projected yet (window just started, or no quota snapshot)',
      forecastObserved: 'observed',
      forecastProjected: 'projected',
      forecastCeiling: '100% ceiling',
      forecastResetMarker: 'reset',
      forecastNowMarker: 'now',
      forecastEstimation: 'Estimate: upstream reports integer percentages only and cached tokens may be discounted; the curve is token-derived',
      forecastRate: 'rate',
      forecastPerPercent: '≈',
      forecastExhaustEstimate: 'runs out',
      forecastAtResetEstimate: 'at reset ≈',
      verdictEnough: 'enough',
      verdictTight: 'tight',
      verdictNotEnough: 'not enough',
      verdictUncertain: 'uncertain',
      verdictUnknown: 'unknown',
      stateNoWindow: 'Upstream reports no window length',
      stateNoSnapshot: 'No quota snapshot',
      stateStaleSnapshot: 'Snapshot predates the reset; waiting for upstream refresh',
      stateWindowNotStarted: 'Window just started, not enough data',
      stateTruncated: 'Window start predates available history',
      stateQuiet: 'No consumption in this window yet',
      stateNoUsage: 'No usage recorded in this window',
      stateRateUnavailable: 'No recent consumption, rate unavailable',
      currentGroupAccount: 'Current Group Upstream Account',
      currentGroupAccountHint: 'Quota status for the OpenAI OAuth account used by this group',
      accountName: 'Account',
      fiveHourQuota: '5h Used',
      sevenDayQuota: '7d Used',
      resetAt: 'Reset',
      snapshotAt: 'Snapshot',
      recent5h: 'Last 5h',
      recent7d: 'Last 7d',
      modelStats: 'Model Stats',
      modelStatsHint: 'Request volume and token usage by model',
      keyName: 'Key Name',
      modelName: 'Model',
      status: 'Status',
      requestsShort: 'Requests',
      inputShort: 'Input',
      outputShort: 'Output',
      cacheHitShort: 'Cache Hit',
      latencyShort: 'Latency',
      refreshedAt: 'Refreshed',
      timezone: 'Timezone',
      refreshEvery: 'Refresh',
      groupFilter: 'Group',
      allGroups: 'All Groups',
      groupsUnavailable: 'Unable to load groups',
      noData: 'No usage to show for the selected window',
      seconds: 'sec',
      statusActive: 'Active',
      statusDisabled: 'Disabled',
      statusExpired: 'Expired',
      statusQuota: 'Quota maxed',
      statusUnknown: 'Unknown',
      tabOverview: 'Token Overview',
      tabAdoption: 'AI Coding Adoption',
      adoptionTitle: 'AI Coding Adoption',
      adoptionSubtitle: 'Rolling 30-day window. Person names come from API Key names.',
      adoptionThreshold: 'Effective use: ≥100 AI coding requests, or ≥5 AI coding active days.',
      adoptionRate: 'Adoption Rate',
      effectiveRate: 'Effective Use Rate',
      adoptedPeople: 'Adopted People',
      effectivePeople: 'Effective People',
      notAdoptedPeople: 'Not Adopted',
      lightAdoptionPeople: 'Light Adoption',
      notAdopted: 'Not Adopted',
      lightAdoption: 'Light Adoption',
      effectiveUse: 'Effective Use',
      codingRequests: 'AI Coding Requests',
      codingTokens: 'AI Coding Tokens',
      codingCost: 'AI Coding Cost',
      last30d: 'Last 30 Days',
      adoptionTrend: 'Daily Adoption Trend',
      adoptionTrendHint: 'Cumulative adopted and effective people (last 30 days)',
      clientBreakdown: 'Client Breakdown',
      modelBreakdown: 'Top 5 Models',
      primaryClient: 'Primary Client',
      primaryModel: 'Primary Model',
      personName: 'Person',
      stage: 'Stage',
      codingActiveDays: 'Coding Active Days',
      lastCodingAt: 'Last Coding Use',
      personTableTitle: 'People Detail',
      personTableHint: 'Sorted by governance priority: Not Adopted → Light → Effective',
      people: 'People',
      totalPeople: 'Total People',
      rosterScope: 'Team Roster',
      rosterManage: 'Roster',
      rosterActive: 'Roster Active',
      rosterInactive: 'Roster Not Configured',
      rosterTitle: 'Team Roster Management',
      rosterHint: 'Check API Keys to include in stats, or manually add people without keys',
      rosterAvailableKeys: 'Available Keys in Group',
      rosterCustomNames: 'Custom People (in roster but no key)',
      rosterCustomPlaceholder: 'Type a name and press Enter',
      rosterAddCustom: 'Add',
      rosterSave: 'Save Roster',
      rosterCancel: 'Cancel',
      rosterSaving: 'Saving…',
      rosterLoadError: 'Failed to load roster',
      rosterSaveError: 'Failed to save roster',
      rosterCount: '{n} selected',
      rosterClearAll: 'Clear All',
      rosterSelectAll: 'Select All',
      rosterNoKey: 'No Key',
      close: 'Close',
    },
  }[lang];
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;
}

function formatUsedPercent(value: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatCurrency(value: number) {
  if (!value || Number.isNaN(value)) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1 ? 2 : 4,
  }).format(value);
}

function formatDuration(value: number | null, lang: 'zh' | 'en') {
  if (!value || Number.isNaN(value)) return '—';
  if (value >= 1000) {
    const s = value / 1000;
    return lang === 'zh' ? `${s.toFixed(s >= 10 ? 0 : 1)} 秒` : `${s.toFixed(s >= 10 ? 0 : 1)} s`;
  }
  return lang === 'zh' ? `${Math.round(value)} 毫秒` : `${Math.round(value)} ms`;
}

function formatRelativeTime(dateString: string | null, lang: 'zh' | 'en') {
  if (!dateString) return '—';
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 1) return lang === 'zh' ? '刚刚' : 'just now';
  if (diffMinutes < 60) return lang === 'zh' ? `${diffMinutes} 分钟前` : `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return lang === 'zh' ? `${diffHours} 小时前` : `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return lang === 'zh' ? `${diffDays} 天前` : `${diffDays}d ago`;
}

function quotaTone(value: number | null) {
  if (value === null) return 'neutral';
  if (value >= 100) return 'critical';
  if (value >= 80) return 'warning';
  return 'ok';
}

function buildPath(path: string) {
  return `${appConfig.boardBasePath}${path}`;
}

function buildBoardQuery(range: BoardRange, groupId: number | null) {
  const params = new URLSearchParams({ range });
  if (groupId !== null) {
    params.set('group_id', String(groupId));
  }
  return params.toString();
}

async function getJson<T>(
  path: string,
  token: string,
  range: BoardRange,
  groupId: number | null,
): Promise<T> {
  const response = await fetch(`${buildPath(path)}?${buildBoardQuery(range, groupId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const payload = (await response.json()) as { ok: boolean; data?: T; error?: string };
  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.error || 'Failed to load board data');
  }
  return payload.data;
}

async function getGroupsJson(token: string): Promise<GroupsPayload> {
  const response = await fetch(buildPath('/api/groups'), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const payload = (await response.json()) as { ok: boolean; data?: GroupsPayload; error?: string };
  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.error || 'Failed to load groups');
  }
  return payload.data;
}

function useBoardData(
  range: BoardRange,
  token: string | null,
  groupId: number | null,
  rosterRevision = 0,
) {
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: 'Missing admin token' });
      return;
    }

    let timeoutId: NodeJS.Timeout | null = null;
    let cancelled = false;

    const load = async () => {
      try {
        const [summary, ranking, models, accountQuotas, quotaProjection, openaiStatus] =
          await Promise.all([
            getJson<SummaryPayload>('/api/summary', token, range, groupId),
            getJson<RankingPayload>('/api/ranking', token, range, groupId),
            getJson<ModelStatsPayload>('/api/models', token, range, groupId),
            getJson<AccountQuotasPayload>('/api/account-quotas', token, range, groupId),
            // 固定看当前 7d 窗口，不跟随 today/7d 切换
            getJson<QuotaProjectionPayload>('/api/quota-projection', token, range, groupId),
            getJson<OpenAIStatusPayload>('/api/openai-status', token, range, groupId),
          ]);
        if (!cancelled && mountedRef.current) {
          setState({
            kind: 'ready',
            data: { summary, accountQuotas, quotaProjection, ranking, models, openaiStatus },
            refreshedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        if (!cancelled && mountedRef.current) {
          setState({ kind: 'error', message: error instanceof Error ? error.message : 'Unexpected error' });
        }
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(load, appConfig.refreshSeconds * 1000);
        }
      }
    };

    setState((current) => (current.kind === 'ready' ? current : { kind: 'loading' }));
    void load();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [range, token, groupId, rosterRevision]);

  return state;
}

function useGroups(token: string | null, lang: 'zh' | 'en') {
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setGroups([]);
      setError(null);
      return;
    }

    let cancelled = false;
    void getGroupsJson(token)
      .then((payload) => {
        if (!cancelled) {
          setGroups(payload.rows);
          setError(null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setGroups([]);
          setError(loadError instanceof Error ? loadError.message : copyFor(lang).groupsUnavailable);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [lang, token]);

  return { groups, error };
}

function usePersistedToken(searchToken: string | null) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const persisted = typeof window !== 'undefined' ? window.sessionStorage.getItem(TOKEN_STORAGE_KEY) : null;
    const normalized = searchToken?.trim() || persisted;
    if (normalized) {
      setToken(normalized);
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, normalized);
    } else {
      setToken(null);
    }
    if (searchToken && typeof window !== 'undefined') {
      const next = new URL(window.location.href);
      next.searchParams.delete('token');
      window.history.replaceState({}, '', next.toString());
    }
  }, [searchToken]);

  return token;
}

function readPersistedGroupId() {
  if (typeof window === 'undefined') return null;

  const persisted = window.localStorage.getItem(GROUP_STORAGE_KEY);
  if (!persisted) return null;

  const parsed = Number(persisted);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function persistGroupId(groupId: number | null) {
  if (typeof window === 'undefined') return;

  if (groupId === null) {
    window.localStorage.removeItem(GROUP_STORAGE_KEY);
  } else {
    window.localStorage.setItem(GROUP_STORAGE_KEY, String(groupId));
  }
}

const ADOPTION_GROUP_STORAGE_KEY = 'apikey-board:adoption-group-id';

function parseView(raw: string | null): BoardView {
  return raw === 'adoption' ? 'adoption' : 'overview';
}

function readAdoptionGroupState(): { hasPreference: boolean; groupId: number | null } {
  if (typeof window === 'undefined') return { hasPreference: false, groupId: null };

  const persisted = window.localStorage.getItem(ADOPTION_GROUP_STORAGE_KEY);
  if (persisted === null) return { hasPreference: false, groupId: null };
  if (persisted === 'all') return { hasPreference: true, groupId: null };

  const parsed = Number(persisted);
  return Number.isInteger(parsed) && parsed > 0
    ? { hasPreference: true, groupId: parsed }
    : { hasPreference: true, groupId: null };
}

function persistAdoptionGroupId(groupId: number | null) {
  if (typeof window === 'undefined') return;

  if (groupId === null) {
    window.localStorage.setItem(ADOPTION_GROUP_STORAGE_KEY, 'all');
  } else {
    window.localStorage.setItem(ADOPTION_GROUP_STORAGE_KEY, String(groupId));
  }
}

function buildAdoptionQuery(groupId: number | null, lang: AdoptionLang) {
  const params = new URLSearchParams({ lang });
  if (groupId !== null) {
    params.set('group_id', String(groupId));
  }
  return params.toString();
}

async function getAdoptionJson(
  token: string,
  groupId: number | null,
  lang: AdoptionLang,
): Promise<AdoptionPayload> {
  const response = await fetch(
    `${buildPath('/api/adoption')}?${buildAdoptionQuery(groupId, lang)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    },
  );
  const payload = (await response.json()) as { ok: boolean; data?: AdoptionPayload; error?: string };
  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.error || 'Failed to load adoption data');
  }
  return payload.data;
}

async function getRosterJson(token: string, groupId: number | null): Promise<RosterPayload> {
  const params = new URLSearchParams();
  if (groupId !== null) params.set('group_id', String(groupId));
  const response = await fetch(`${buildPath('/api/adoption/roster')}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const payload = (await response.json()) as { ok: boolean; data?: RosterPayload; error?: string };
  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.error || 'Failed to load roster');
  }
  return payload.data;
}

async function saveRosterJson(token: string, names: string[]): Promise<void> {
  const response = await fetch(buildPath('/api/adoption/roster'), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ names }),
  });
  const payload = (await response.json()) as { ok: boolean; error?: string };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Failed to save roster');
  }
}

function useAdoptionData(
  token: string | null,
  groupId: number | null,
  lang: AdoptionLang,
  rosterRevision = 0,
) {
  const [state, setState] = useState<DataState<AdoptionPayload>>({ kind: 'loading' });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: 'Missing admin token' });
      return;
    }

    let timeoutId: NodeJS.Timeout | null = null;
    let cancelled = false;

    const load = async () => {
      try {
        const payload = await getAdoptionJson(token, groupId, lang);
        if (!cancelled && mountedRef.current) {
          setState({
            kind: 'ready',
            data: payload,
            refreshedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        if (!cancelled && mountedRef.current) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Unexpected error',
          });
        }
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(load, appConfig.refreshSeconds * 1000);
        }
      }
    };

    setState((current) => (current.kind === 'ready' ? current : { kind: 'loading' }));
    void load();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [token, groupId, lang, rosterRevision]);

  return state;
}

function stageTone(stage: AdoptionStage): string {
  if (stage === 'effective_use') return 'var(--c-teal)';
  if (stage === 'light_adoption') return 'var(--c-amber)';
  return 'var(--c-rose)';
}

function MetricCard({ label, value, detail, accent }: { label: string; value: string; detail: string; accent: string }) {
  return (
    <div className="metric-card" style={{ ['--accent' as string]: accent }}>
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">{value}</div>
      <div className="metric-card__detail">{detail}</div>
    </div>
  );
}

function StatusBadge({ status, lang }: { status: string; lang: 'zh' | 'en' }) {
  const copy = copyFor(lang);
  const normalized = status.toLowerCase();
  const label =
    normalized === 'active' ? copy.statusActive
    : normalized === 'disabled' || normalized === 'inactive' ? copy.statusDisabled
    : normalized === 'expired' ? copy.statusExpired
    : normalized === 'quota_exhausted' ? copy.statusQuota
    : copy.statusUnknown;
  return <span className={`status-badge status-badge--${normalized}`}>{label}</span>;
}

function QuotaMeter({
  label,
  usedPercent,
  resetAt,
  lang,
}: {
  label: string;
  usedPercent: number | null;
  resetAt: string | null;
  lang: 'zh' | 'en';
}) {
  const copy = copyFor(lang);
  const tone = quotaTone(usedPercent);
  const width = `${Math.min(100, Math.max(0, usedPercent ?? 0))}%`;
  return (
    <div className={`quota-meter quota-meter--${tone}`}>
      <div className="quota-meter__topline">
        <span>{label}</span>
        <strong>{formatUsedPercent(usedPercent)}</strong>
      </div>
      <div className="quota-meter__track">
        <span style={{ width }} />
      </div>
      <small title={formatResetTime(resetAt, lang)}>
        {copy.resetAt} {formatAbsoluteMinute(resetAt)}
      </small>
    </div>
  );
}

function AccountQuotaTraffic({ row, lang }: { row: AccountQuotaRow; lang: 'zh' | 'en' }) {
  const copy = copyFor(lang);
  return (
    <div className="quota-account__traffic">
      <div>
        <span>{copy.recent5h}</span>
        <strong>{formatCompact(row.tokens5h)}</strong>
        <small>
          {formatInteger(row.requests5h)} {copy.requestsShort} · {formatCurrency(row.cost5h)}
        </small>
      </div>
      <div>
        <span>{copy.recent7d}</span>
        <strong>{formatCompact(row.tokens7d)}</strong>
        <small>
          {formatInteger(row.requests7d)} {copy.requestsShort} · {formatCurrency(row.cost7d)}
        </small>
      </div>
    </div>
  );
}

function QuotaAccountCard({ row, lang, featured = false }: { row: AccountQuotaRow; lang: 'zh' | 'en'; featured?: boolean }) {
  const copy = copyFor(lang);
  const subscription = parseSubscriptionExpiry(row.subscriptionExpiresAt);
  return (
    <article className={featured ? 'quota-account quota-account--featured' : 'quota-account'}>
      <div className="quota-account__header">
        <div className="quota-account__identity">
          <strong>{row.accountName || `account-${row.accountId}`}</strong>
          <small>
            #{row.accountId} · {copy.snapshotAt} {formatRelativeTime(row.usageUpdatedAt, lang)}
          </small>
          <small className="quota-subscription">
            <span>{copy.subscriptionUntil}</span>
            <strong className={subscription.stale ? 'is-stale' : undefined}>
              {subscription.date ?? copy.subscriptionMissing}
            </strong>
            {row.planType ? <em className="plan-badge">{planTypeLabel(row.planType, lang)}</em> : null}
            {subscription.stale ? (
              <em className="plan-badge plan-badge--stale" title={copy.subscriptionStaleHint}>
                {copy.subscriptionStaleTag}
              </em>
            ) : null}
          </small>
        </div>
        <StatusBadge status={row.status} lang={lang} />
      </div>
      <div className="quota-account__meters">
        <QuotaMeter
          label={copy.fiveHourQuota}
          usedPercent={row.fiveHour.usedPercent}
          resetAt={row.fiveHour.resetAt}
          lang={lang}
        />
        <QuotaMeter
          label={copy.sevenDayQuota}
          usedPercent={row.sevenDay.usedPercent}
          resetAt={row.sevenDay.resetAt}
          lang={lang}
        />
      </div>
      <AccountQuotaTraffic row={row} lang={lang} />
    </article>
  );
}

function AccountQuotaPool({
  rows,
  lang,
  isGroupSelected,
}: {
  rows: AccountQuotaRow[];
  lang: 'zh' | 'en';
  isGroupSelected: boolean;
}) {
  const copy = copyFor(lang);
  const primary = rows[0] ?? null;
  const title = isGroupSelected ? copy.currentGroupAccount : copy.accountQuotas;
  const hint = isGroupSelected ? copy.currentGroupAccountHint : copy.accountQuotasHint;

  return (
    <section className={isGroupSelected ? 'quota-card quota-card--group' : 'quota-card'}>
      <div className="section-heading">
        <p className="section-heading__eyebrow">{title}</p>
        <h2>{hint}</h2>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state empty-state--compact">{copy.accountQuotasEmpty}</div>
      ) : isGroupSelected && rows.length === 1 && primary ? (
        <div className="quota-group-layout">
          <QuotaAccountCard row={primary} lang={lang} featured />
        </div>
      ) : (
        <div className={isGroupSelected ? 'quota-grid quota-grid--group' : 'quota-grid'}>
          {rows.map((row) => (
            <QuotaAccountCard key={row.accountId} row={row} lang={lang} />
          ))}
        </div>
      )}
    </section>
  );
}

function OpenAIStatusBanner({ payload, lang }: { payload: OpenAIStatusPayload; lang: 'zh' | 'en' }) {
  const copy = copyFor(lang);
  const tone =
    payload.indicator === 'none' ? 'ok'
      : payload.indicator === 'minor' ? 'warning'
        : payload.indicator === 'major' ? 'critical' : 'neutral';
  const label =
    payload.indicator === 'none' ? copy.statusNone
      : payload.indicator === 'minor' ? copy.statusMinor
        : payload.indicator === 'major' ? copy.statusMajor : copy.statusUnknown;
  return (
    <div className={`status-banner status-banner--${tone}`}>
      <span className="status-banner__dot" />
      <strong>{copy.openaiStatus}</strong>
      <span>{label}</span>
      {payload.indicator !== 'unknown' ? <small>{payload.description}</small> : null}
      <small className="status-banner__time">{new Date(payload.fetchedAt).toLocaleTimeString()}</small>
    </div>
  );
}

function StatsTable({
  title, hint, nameLabel, rows, lang,
}: {
  title: string;
  hint: string;
  nameLabel: string;
  rows: Array<{
    id: string | number;
    name: string;
    status?: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    cacheHitRate: number | null;
    averageDurationMs: number | null;
    meta?: string;
  }>;
  lang: 'zh' | 'en';
}) {
  const copy = copyFor(lang);
  return (
    <section className="stats-card">
      <div className="section-heading">
        <p className="section-heading__eyebrow">{title}</p>
        <h2>{hint}</h2>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">{copy.noData}</div>
      ) : (
        <div className="stats-table">
          <div className="stats-table__head">
            <span className="stats-table__name">{nameLabel}</span>
            <span>{copy.requestsShort}</span>
            <span>{copy.inputShort}</span>
            <span>{copy.outputShort}</span>
            <span>{copy.cacheHitShort}</span>
            <span>{copy.latencyShort}</span>
          </div>
          <div className="stats-table__body">
            {rows.map((row) => (
              <div key={row.id} className="stats-table__row">
                <div className="stats-table__name">
                  <div className="stats-table__title-line">
                    <strong>{row.name}</strong>
                    {row.status ? <StatusBadge status={row.status} lang={lang} /> : null}
                  </div>
                  {row.meta ? <small>{row.meta}</small> : null}
                </div>
                <span>{formatInteger(row.requests)}</span>
                <span>{formatCompact(row.inputTokens)}</span>
                <span>{formatCompact(row.outputTokens)}</span>
                <span>
                  {formatCompact(row.cacheTokens)}
                  {row.cacheHitRate !== null ? (
                    <small style={{ display: 'block', color: 'var(--muted-mid)', fontSize: '0.75em' }}>
                      {formatPercent(row.cacheHitRate)}
                    </small>
                  ) : null}
                </span>
                <span>{formatDuration(row.averageDurationMs, lang)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function AdoptionSummaryCards({ payload, lang }: { payload: AdoptionPayload; lang: 'zh' | 'en' }) {
  const copy = copyFor(lang);
  const summary = payload.summary;
  const rate = (value: number) => `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;

  return (
    <section className="metrics-grid metrics-grid--adoption">
      <MetricCard
        label={copy.adoptionRate}
        value={rate(summary.adoptionRate)}
        detail={`${copy.adoptedPeople} ${formatInteger(summary.adoptedPeople)} / ${formatInteger(summary.totalPeople)}`}
        accent="var(--c-blue)"
      />
      <MetricCard
        label={copy.effectiveRate}
        value={rate(summary.effectiveRate)}
        detail={`${copy.effectivePeople} ${formatInteger(summary.effectivePeople)} / ${formatInteger(summary.totalPeople)}`}
        accent="var(--c-teal)"
      />
      <MetricCard
        label={copy.notAdoptedPeople}
        value={formatInteger(summary.notAdoptedPeople)}
        detail={`${copy.lightAdoptionPeople} ${formatInteger(summary.lightAdoptionPeople)}`}
        accent="var(--c-rose)"
      />
      <MetricCard
        label={copy.codingRequests}
        value={formatInteger(summary.codingRequests)}
        detail={copy.last30d}
        accent="var(--c-amber)"
      />
      <MetricCard
        label={copy.codingTokens}
        value={formatCompact(summary.codingTokens)}
        detail={copy.last30d}
        accent="var(--c-violet)"
      />
      <MetricCard
        label={copy.codingCost}
        value={formatCurrency(summary.codingCost)}
        detail={copy.last30d}
        accent="var(--c-teal)"
      />
    </section>
  );
}

function AdoptionTrendChart({ payload, lang }: { payload: AdoptionPayload; lang: 'zh' | 'en' }) {
  const copy = copyFor(lang);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 960;
  const height = 280;
  const margin = { top: 18, right: 22, bottom: 34, left: 44 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const points = payload.trend;
  const maxValue = Math.max(1, ...points.map((point) => point.adoptedPeople));
  const yTicks = Array.from({ length: 5 }, (_, index) => Math.round(maxValue * (1 - index / 4)));
  const xTickStep = points.length <= 8 ? 1 : Math.ceil(points.length / 6);
  const xTickIndexes = points
    .map((_, index) => index)
    .filter((index) => index === 0 || index === points.length - 1 || index % xTickStep === 0);

  const pointX = (index: number) => {
    if (points.length <= 1) return margin.left + plotWidth / 2;
    return margin.left + (index / (points.length - 1)) * plotWidth;
  };

  const pointY = (value: number) => margin.top + plotHeight - (value / maxValue) * plotHeight;

  const adoptedPath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${pointX(index).toFixed(2)} ${pointY(point.adoptedPeople).toFixed(2)}`)
    .join(' ');
  const effectivePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${pointX(index).toFixed(2)} ${pointY(point.effectivePeople).toFixed(2)}`)
    .join(' ');

  const formatDayLabel = (day: string) => {
    const parts = day.split('-');
    return parts.length === 3 ? `${parts[1]}-${parts[2]}` : day;
  };

  return (
    <section className="trend-card">
      <div className="trend-card__topline">
        <div className="section-heading">
          <p className="section-heading__eyebrow">{copy.adoptionTrend}</p>
          <h2>{copy.adoptionTrendHint}</h2>
        </div>
        <div className="trend-legend">
          <span className="trend-legend__item" style={{ ['--series-color' as string]: 'var(--c-blue)' }}>
            <span>{copy.adoptedPeople}</span>
            <strong>{points.length ? formatInteger(points[points.length - 1].adoptedPeople) : 0}</strong>
          </span>
          <span className="trend-legend__item" style={{ ['--series-color' as string]: 'var(--c-teal)' }}>
            <span>{copy.effectivePeople}</span>
            <strong>{points.length ? formatInteger(points[points.length - 1].effectivePeople) : 0}</strong>
          </span>
        </div>
      </div>

      {points.length === 0 ? (
        <div className="empty-state">{copy.noData}</div>
      ) : (
        <div className="trend-chart__canvas" onMouseLeave={() => setHoverIndex(null)}>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={copy.adoptionTrend}>
            <g className="trend-grid">
              {yTicks.map((tick) => {
                const y = pointY(tick);
                return (
                  <g key={tick}>
                    <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} />
                    <text x={margin.left - 8} y={y + 4} textAnchor="end">{tick}</text>
                  </g>
                );
              })}
              {xTickIndexes.map((index) => (
                <g key={points[index].day}>
                  <line x1={pointX(index)} y1={margin.top} x2={pointX(index)} y2={height - margin.bottom} />
                  <text x={pointX(index)} y={height - 10} textAnchor="middle">{formatDayLabel(points[index].day)}</text>
                </g>
              ))}
            </g>
            <line className="trend-axis" x1={margin.left} y1={height - margin.bottom} x2={width - margin.right} y2={height - margin.bottom} />
            <line className="trend-axis" x1={margin.left} y1={margin.top} x2={margin.left} y2={height - margin.bottom} />
            <g className="trend-series" style={{ ['--series-color' as string]: 'var(--c-blue)' }}>
              <path d={adoptedPath} />
            </g>
            <g className="trend-series" style={{ ['--series-color' as string]: 'var(--c-teal)' }}>
              <path d={effectivePath} />
            </g>
            <g>
              {points.map((point, index) => {
                const x = pointX(index);
                return (
                  <rect
                    key={point.day}
                    className="trend-hit-point"
                    x={x - Math.max(4, plotWidth / points.length / 2)}
                    y={margin.top}
                    width={Math.max(8, plotWidth / points.length)}
                    height={plotHeight}
                    fill="transparent"
                    onMouseEnter={() => setHoverIndex(index)}
                    onMouseLeave={() => setHoverIndex(null)}
                  />
                );
              })}
            </g>
            {hoverIndex !== null && points[hoverIndex] ? (
              <g pointerEvents="none">
                <line
                  x1={pointX(hoverIndex)}
                  y1={margin.top}
                  x2={pointX(hoverIndex)}
                  y2={height - margin.bottom}
                  stroke="var(--muted)"
                  strokeDasharray="3 3"
                />
                <circle cx={pointX(hoverIndex)} cy={pointY(points[hoverIndex].adoptedPeople)} r={3.5} fill="var(--c-blue)" />
                <circle cx={pointX(hoverIndex)} cy={pointY(points[hoverIndex].effectivePeople)} r={3.5} fill="var(--c-teal)" />
              </g>
            ) : null}
          </svg>
          {hoverIndex !== null && points[hoverIndex] ? (
            <div
              className="trend-tooltip"
              style={{
                ['--tooltip-color' as string]: 'var(--c-blue)',
                left: `${(pointX(hoverIndex) / width) * 100}%`,
                top: `${(margin.top / height) * 100}%`,
              }}
            >
              <span>{formatDayLabel(points[hoverIndex].day)}</span>
              <small style={{ color: 'var(--c-blue)' }}>
                {copy.adoptedPeople}: {formatInteger(points[hoverIndex].adoptedPeople)}
              </small>
              <small style={{ color: 'var(--c-teal)' }}>
                {copy.effectivePeople}: {formatInteger(points[hoverIndex].effectivePeople)}
              </small>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function AdoptionBreakdown({ payload, lang }: { payload: AdoptionPayload; lang: 'zh' | 'en' }) {
  const copy = copyFor(lang);
  const totalRequests = payload.summary.codingRequests || 1;

  return (
    <div className="tables-stack tables-stack--adoption">
      <section className="stats-card">
        <div className="section-heading">
          <p className="section-heading__eyebrow">{copy.clientBreakdown}</p>
          <h2>{copy.last30d}</h2>
        </div>
        {payload.clients.length === 0 ? (
          <div className="empty-state empty-state--compact">{copy.noData}</div>
        ) : (
          <div className="breakdown-list">
            {payload.clients.map((row) => (
              <div key={row.client} className="breakdown-row">
                <div className="breakdown-row__label">
                  <span className="breakdown-dot" style={{ ['--dot-color' as string]: clientBreakdownColor(row.client) }} />
                  <strong>{row.label}</strong>
                </div>
                <div className="breakdown-row__bar">
                  <span style={{ width: `${(row.requests / totalRequests) * 100}%`, ['--bar-color' as string]: clientBreakdownColor(row.client) }} />
                </div>
                <div className="breakdown-row__meta">
                  <span>{formatInteger(row.requests)} {copy.requestsShort}</span>
                  <small>{row.people} {copy.people}</small>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="stats-card">
        <div className="section-heading">
          <p className="section-heading__eyebrow">{copy.modelBreakdown}</p>
          <h2>{copy.last30d}</h2>
        </div>
        {payload.models.length === 0 ? (
          <div className="empty-state empty-state--compact">{copy.noData}</div>
        ) : (
          <div className="stats-table stats-table--models">
            <div className="stats-table__head stats-table__head--models">
              <span>{copy.modelName}</span>
              <span>{copy.people}</span>
              <span>{copy.requestsShort}</span>
              <span>{copy.tokenLabel}</span>
            </div>
            <div className="stats-table__body">
              {payload.models.map((row) => (
                <div key={row.model} className="stats-table__row stats-table__row--models">
                  <span className="stats-table__model-name">{row.model}</span>
                  <span>{formatInteger(row.people)}</span>
                  <span>{formatInteger(row.requests)}</span>
                  <span>{formatCompact(row.tokens)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function clientBreakdownColor(client: AdoptionClientType): string {
  if (client === 'codex_tui') return 'var(--c-blue)';
  if (client === 'codex_desktop') return 'var(--c-violet)';
  if (client === 'claude_code') return 'var(--c-teal)';
  return 'var(--c-amber)';
}

function AdoptionStageBadge({ stage, lang }: { stage: AdoptionStage; lang: 'zh' | 'en' }) {
  const tone = stageTone(stage);
  return (
    <span className="adoption-stage-badge" style={{ ['--stage-color' as string]: tone }}>
      {stageLabel(stage, lang)}
    </span>
  );
}

function AdoptionPersonTable({ payload, lang }: { payload: AdoptionPayload; lang: 'zh' | 'en' }) {
  const copy = copyFor(lang);
  const rows = payload.people;

  return (
    <section className="stats-card">
      <div className="section-heading">
        <p className="section-heading__eyebrow">{copy.personTableTitle}</p>
        <h2>{copy.personTableHint}</h2>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">{copy.noData}</div>
      ) : (
        <div className="adoption-table">
          <div className="adoption-table__head">
            <span>{copy.personName}</span>
            <span>{copy.stage}</span>
            <span>{copy.requestsShort}</span>
            <span>{copy.codingActiveDays}</span>
            <span>{copy.tokenLabel}</span>
            <span>{copy.codingCost}</span>
            <span>{copy.lastCodingAt}</span>
            <span>{copy.primaryClient}</span>
            <span>{copy.primaryModel}</span>
          </div>
          <div className="adoption-table__body">
            {rows.map((row) => (
              <div key={row.apiKeyId} className="adoption-table__row">
                <div className="adoption-table__name">
                  <strong>{row.personName || `key-${row.apiKeyId}`}</strong>
                  <small>{row.apiKeyId > 0 ? `#${row.apiKeyId}` : copy.rosterNoKey}</small>
                </div>
                <AdoptionStageBadge stage={row.stage} lang={lang} />
                <span>{formatInteger(row.codingRequests)}</span>
                <span>{formatInteger(row.codingActiveDays)}</span>
                <span>{formatCompact(row.codingTokens)}</span>
                <span>{formatCurrency(row.codingCost)}</span>
                <span>{formatRelativeTime(row.lastCodingAt, lang)}</span>
                <span>{row.primaryClientLabel || '-'}</span>
                <span className="adoption-table__model">{row.primaryModel || '-'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function rosterStatus(
  lang: 'zh' | 'en',
  active: boolean,
  total: number,
): string {
  const copy = copyFor(lang);
  return active ? `${copy.rosterActive} (${total})` : copy.rosterInactive;
}

function RosterScopeBar({
  lang,
  active,
  total,
  adoptionTimezone,
  onManage,
}: {
  lang: 'zh' | 'en';
  active: boolean;
  total: number;
  adoptionTimezone?: string;
  onManage: () => void;
}) {
  const copy = copyFor(lang);
  const status = rosterStatus(lang, active, total);
  const isAdoption = adoptionTimezone !== undefined;

  return (
    <section className="adoption-intro roster-scope-bar">
      <div>
        <p className="adoption-intro__threshold">
          {isAdoption ? copy.adoptionThreshold : copy.rosterScope}
        </p>
        <p className="adoption-intro__window">
          {isAdoption
            ? `${copy.last30d} · ${copy.timezone} ${adoptionTimezone} · ${status}`
            : status}
        </p>
      </div>
      <button
        type="button"
        className="range-switcher__button roster-manage-btn"
        onClick={onManage}
      >
        {copy.rosterManage}
      </button>
    </section>
  );
}

function RosterManagerDialog({
  token,
  groupId,
  lang,
  onClose,
  onSaved,
}: {
  token: string;
  groupId: number | null;
  lang: 'zh' | 'en';
  onClose: () => void;
  onSaved: () => void;
}) {
  const copy = copyFor(lang);
  const [availableKeys, setAvailableKeys] = useState<RosterKeyOption[]>([]);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(() => new Set());
  const [customName, setCustomName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getRosterJson(token, groupId)
      .then((payload) => {
        if (!cancelled) {
          setAvailableKeys(payload.availableKeys);
          setSelectedNames(new Set(payload.names));
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : copy.rosterLoadError);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [copy.rosterLoadError, groupId, token]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  const toggleName = (name: string) => {
    setSelectedNames((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const addCustomName = () => {
    const name = customName.trim();
    if (!name) return;
    setSelectedNames((current) => new Set(current).add(name));
    setCustomName('');
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveRosterJson(
        token,
        Array.from(selectedNames).sort((a, b) => a.localeCompare(b, 'zh-Hans')),
      );
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.rosterSaveError);
      setSaving(false);
    }
  };

  const customNames = Array.from(selectedNames)
    .filter((name) => !availableKeys.some((key) => key.name === name))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans'));
  const countLabel = copy.rosterCount.replace('{n}', String(selectedNames.size));

  return (
    <div className="roster-overlay" onClick={saving ? undefined : onClose}>
      <div
        className="roster-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="roster-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="roster-modal__header">
          <div>
            <h2 id="roster-dialog-title" className="roster-modal__title">{copy.rosterTitle}</h2>
            <p className="roster-modal__hint">{copy.rosterHint}</p>
          </div>
          <button
            type="button"
            className="roster-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label={copy.close}
            title={copy.close}
          >
            ×
          </button>
        </div>

        {loading ? (
          <div className="roster-modal__body roster-modal__body--loading">
            <div className="board-spinner" />
            <p>{copy.loading}</p>
          </div>
        ) : (
          <div className="roster-modal__body">
            {error ? <div className="roster-modal__error">{error}</div> : null}
            <div className="roster-modal__section">
              <div className="roster-modal__section-head">
                <span className="roster-modal__section-title">{copy.rosterAvailableKeys}</span>
                <div className="roster-modal__bulk">
                  <button
                    type="button"
                    className="roster-chip"
                    onClick={() => setSelectedNames(new Set(availableKeys.map((key) => key.name)))}
                  >
                    {copy.rosterSelectAll}
                  </button>
                  <button
                    type="button"
                    className="roster-chip"
                    onClick={() => setSelectedNames(new Set())}
                  >
                    {copy.rosterClearAll}
                  </button>
                </div>
              </div>
              <div className="roster-key-list">
                {availableKeys.map((key) => (
                  <label
                    key={key.id}
                    className={selectedNames.has(key.name) ? 'roster-key-item is-checked' : 'roster-key-item'}
                  >
                    <input
                      type="checkbox"
                      checked={selectedNames.has(key.name)}
                      onChange={() => toggleName(key.name)}
                    />
                    <span>{key.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="roster-modal__section">
              <span className="roster-modal__section-title">{copy.rosterCustomNames}</span>
              <div className="roster-custom-input">
                <input
                  type="text"
                  value={customName}
                  placeholder={copy.rosterCustomPlaceholder}
                  onChange={(event) => setCustomName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addCustomName();
                    }
                  }}
                />
                <button
                  type="button"
                  className="roster-chip"
                  onClick={addCustomName}
                  disabled={!customName.trim()}
                >
                  {copy.rosterAddCustom}
                </button>
              </div>
              <div className="roster-custom-list">
                {customNames.map((name) => (
                  <span key={name} className="roster-custom-tag">
                    {name}
                    <button
                      type="button"
                      onClick={() => toggleName(name)}
                      aria-label={`${copy.close} ${name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {customNames.length === 0 ? (
                  <span className="roster-custom-empty">{copy.rosterNoKey}</span>
                ) : null}
              </div>
            </div>
          </div>
        )}

        <div className="roster-modal__footer">
          <span className="roster-modal__count">{countLabel}</span>
          <div className="roster-modal__actions">
            <button
              type="button"
              className="range-switcher__button"
              onClick={onClose}
              disabled={saving}
            >
              {copy.rosterCancel}
            </button>
            <button
              type="button"
              className="range-switcher__button is-active"
              onClick={() => void save()}
              disabled={saving || loading}
            >
              {saving ? copy.rosterSaving : copy.rosterSave}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdoptionView({
  state,
  lang,
  onManageRoster,
}: {
  state: DataState<AdoptionPayload>;
  lang: 'zh' | 'en';
  onManageRoster: () => void;
}) {
  const copy = copyFor(lang);

  if (state.kind === 'loading') {
    return (
      <section className="board-state">
        <div className="board-spinner" />
        <p>{copy.loading}</p>
      </section>
    );
  }

  if (state.kind === 'error') {
    return (
      <section className="board-state board-state--error">
        <p>{state.message === 'Missing admin token' ? copy.unauthorized : state.message}</p>
        <button type="button" className="range-switcher__button is-active" onClick={() => window.location.reload()}>
          {copy.retry}
        </button>
      </section>
    );
  }

  const payload = state.data;

  return (
    <>
      <RosterScopeBar
        lang={lang}
        active={payload.rosterActive}
        total={payload.rosterTotal}
        adoptionTimezone={payload.timezone}
        onManage={onManageRoster}
      />

      <AdoptionSummaryCards payload={payload} lang={lang} />
      <AdoptionTrendChart payload={payload} lang={lang} />
      <AdoptionBreakdown payload={payload} lang={lang} />
      <AdoptionPersonTable payload={payload} lang={lang} />
    </>
  );
}

export function APIKeyBoard() {
  const searchParams = useSearchParams();
  const lang = readLang(searchParams.get('lang'));
  const theme = readTheme(searchParams.get('theme'));
  const copy = copyFor(lang);
  const token = usePersistedToken(searchParams.get('token'));
  const [view, setView] = useState<BoardView>(() => parseView(searchParams.get('view')));
  const [range, setRange] = useState<BoardRange>('today');
  const [rosterRevision, setRosterRevision] = useState(0);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [overviewGroupId, setOverviewGroupId] = useState<number | null>(() => readPersistedGroupId());
  const initialAdoptionGroup = useMemo(() => readAdoptionGroupState(), []);
  const [adoptionGroupId, setAdoptionGroupId] = useState<number | null>(initialAdoptionGroup.groupId);
  const adoptionDefaultApplied = useRef(false);
  const { groups, error: groupsError } = useGroups(token, lang);
  const groupId = view === 'adoption' ? adoptionGroupId : overviewGroupId;
  const state = useBoardData(
    range,
    view === 'overview' ? token : null,
    overviewGroupId,
    rosterRevision,
  );
  const adoptionState = useAdoptionData(
    view === 'adoption' ? token : null,
    adoptionGroupId,
    lang,
    rosterRevision,
  );

  const activeRefreshedAt =
    view === 'overview'
      ? state.kind === 'ready' ? state.refreshedAt : null
      : adoptionState.kind === 'ready' ? adoptionState.refreshedAt : null;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!groups.length || groupId === null) return;
    if (groups.some((group) => group.id === groupId)) return;
    if (view === 'adoption') {
      setAdoptionGroupId(null);
      persistAdoptionGroupId(null);
    } else {
      setOverviewGroupId(null);
      persistGroupId(null);
    }
  }, [groupId, groups, view]);

  useEffect(() => {
    if (view !== 'adoption' || adoptionDefaultApplied.current) return;
    if (!groups.length) return;
    adoptionDefaultApplied.current = true;
    if (initialAdoptionGroup.hasPreference) return;
    const found = groups.find((group) => group.name === ADOPTION_DEFAULT_GROUP_NAME);
    if (found) {
      setAdoptionGroupId(found.id);
      persistAdoptionGroupId(found.id);
    }
  }, [view, groups, initialAdoptionGroup.hasPreference]);

  const navigateView = (next: BoardView) => {
    setView(next);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (next === 'adoption') {
        url.searchParams.set('view', 'adoption');
      } else {
        url.searchParams.delete('view');
      }
      window.history.replaceState({}, '', url.toString());
    }
  };

  const rangeTabs = useMemo(
    () => [
      { value: 'today' as const, label: copy.today },
      { value: '7d' as const, label: copy.last7d },
    ],
    [copy.last7d, copy.today],
  );

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === groupId) ?? null,
    [groupId, groups],
  );

  return (
    <main className="board-root">
      <header className="board-header">
        <div>
          <div className="board-header__meta">
            <span className="board-live-dot" />
            <span className="board-eyebrow">API KEY OPS BOARD</span>
          </div>
          <h1 className="board-title">{view === 'adoption' ? copy.adoptionTitle : copy.title}</h1>
          <p className="board-subtitle">{view === 'adoption' ? copy.adoptionSubtitle : copy.subtitle}</p>
        </div>
        <div className="board-header__right">
          <span className="board-timestamp">
            {copy.refreshedAt}: {activeRefreshedAt ? new Date(activeRefreshedAt).toLocaleTimeString() : '—'}
          </span>
          <div className="board-controls">
            <div className="range-switcher view-switcher">
              <button
                type="button"
                className={view === 'overview' ? 'range-switcher__button is-active' : 'range-switcher__button'}
                onClick={() => navigateView('overview')}
              >
                {copy.tabOverview}
              </button>
              <button
                type="button"
                className={view === 'adoption' ? 'range-switcher__button is-active' : 'range-switcher__button'}
                onClick={() => navigateView('adoption')}
              >
                {copy.tabAdoption}
              </button>
              <a
                className="range-switcher__button"
                href={`${appConfig.boardBasePath}/model-trace${token ? `?token=${encodeURIComponent(token)}` : ''}`}
              >
                {lang === 'zh' ? '降智检测' : 'Model Trace'}
              </a>
            </div>
            <label className="group-filter">
              <span>{copy.groupFilter}</span>
              <select
                value={groupId ?? 'all'}
                onChange={(event) => {
                  const value = event.target.value;
                  const nextGroupId = value === 'all' ? null : Number(value);
                  if (view === 'adoption') {
                    setAdoptionGroupId(nextGroupId);
                    persistAdoptionGroupId(nextGroupId);
                  } else {
                    setOverviewGroupId(nextGroupId);
                    persistGroupId(nextGroupId);
                  }
                }}
              >
                <option value="all">{copy.allGroups}</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            {view === 'overview' ? (
              <div className="range-switcher">
                {rangeTabs.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={item.value === range ? 'range-switcher__button is-active' : 'range-switcher__button'}
                    onClick={() => setRange(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {groupsError ? <span className="board-control-error">{copy.groupsUnavailable}</span> : null}
        </div>
      </header>

      {view === 'overview' && (
      <>
      {state.kind === 'loading' && (
        <section className="board-state">
          <div className="board-spinner" />
          <p>{copy.loading}</p>
        </section>
      )}

      {state.kind === 'error' && (
        <section className="board-state board-state--error">
          <p>{state.message === 'Missing admin token' ? copy.unauthorized : state.message}</p>
          <button type="button" className="range-switcher__button is-active" onClick={() => window.location.reload()}>
            {copy.retry}
          </button>
        </section>
      )}

      {state.kind === 'ready' && (
        <>
          <RosterScopeBar
            lang={lang}
            active={state.data.summary.rosterActive}
            total={state.data.summary.rosterTotal}
            onManage={() => setRosterOpen(true)}
          />

          <section className="metrics-grid">
            <MetricCard
              label={copy.requests}
              value={formatInteger(state.data.summary.totalRequests)}
              detail={`${copy.activeKeys} ${state.data.summary.activeKeys} / ${state.data.summary.totalKeys}`}
              accent="var(--c-blue)"
            />
            <MetricCard
              label={copy.inputToken}
              value={formatCompact(state.data.summary.inputTokens)}
              detail={`${copy.totalTokens} ${formatCompact(state.data.summary.totalTokens)}`}
              accent="var(--c-amber)"
            />
            <MetricCard
              label={copy.cacheHitToken}
              value={formatCompact(state.data.summary.cacheTokens)}
              detail={`${copy.cacheHitRate} ${formatPercent(state.data.summary.cacheHitRate)}`}
              accent="var(--c-violet)"
            />
            <MetricCard
              label={copy.outputToken}
              value={formatCompact(state.data.summary.outputTokens)}
              detail={`${copy.avgTtft} ${formatLatencyValue(state.data.summary.averageFirstTokenMs, lang)}`}
              accent="var(--c-rose)"
            />
            <MetricCard
              label={copy.maxTtft}
              value={formatLatencyValue(state.data.summary.maxFirstTokenMs, lang)}
              detail={`${copy.slowCount} ${formatInteger(state.data.summary.slowRequestCount)}`}
              accent="var(--c-rose)"
            />
          </section>

          <OpenAIStatusBanner payload={state.data.openaiStatus} lang={lang} />

          <QuotaProjectionChart
            payload={state.data.quotaProjection}
            labels={{
              title: copy.quotaForecast,
              hint: copy.quotaForecastHint,
              noData: copy.forecastNoData,
              observed: copy.forecastObserved,
              projected: copy.forecastProjected,
              ceiling: copy.forecastCeiling,
              resetMarker: copy.forecastResetMarker,
              nowMarker: copy.forecastNowMarker,
              estimation: copy.forecastEstimation,
              rateLabel: copy.forecastRate,
              perPercentLabel: copy.forecastPerPercent,
              exhaustEstimate: copy.forecastExhaustEstimate,
              atResetEstimate: copy.forecastAtResetEstimate,
              verdicts: {
                enough: copy.verdictEnough,
                tight: copy.verdictTight,
                'not-enough': copy.verdictNotEnough,
                uncertain: copy.verdictUncertain,
                unknown: copy.verdictUnknown,
              },
              states: {
                ok: copy.verdictUnknown,
                'no-window': copy.stateNoWindow,
                'no-snapshot': copy.stateNoSnapshot,
                'stale-snapshot': copy.stateStaleSnapshot,
                'window-not-started': copy.stateWindowNotStarted,
                truncated: copy.stateTruncated,
                quiet: copy.stateQuiet,
                'no-usage': copy.stateNoUsage,
                'rate-unavailable': copy.stateRateUnavailable,
              },
            }}
          />

          <AccountQuotaPool rows={state.data.accountQuotas.rows} lang={lang} isGroupSelected={groupId !== null} />

          <div className="tables-stack">
            <StatsTable
              title={copy.keyStats}
              hint={copy.keyStatsHint}
              nameLabel={copy.keyName}
              lang={lang}
              rows={state.data.ranking.rows.map((row) => ({
                id: row.apiKeyId,
                name: row.keyName || `key-${row.apiKeyId}`,
                status: row.status,
                requests: row.requests,
                inputTokens: row.inputTokens,
                outputTokens: row.outputTokens,
                cacheTokens: row.cacheTokens,
                cacheHitRate: row.cacheHitRate,
                averageDurationMs: row.averageDurationMs,
                meta: `#${row.apiKeyId} · ${copy.refreshedAt} ${formatRelativeTime(row.lastUsedAt, lang)}`,
              }))}
            />
            <StatsTable
              title={copy.modelStats}
              hint={copy.modelStatsHint}
              nameLabel={copy.modelName}
              lang={lang}
              rows={state.data.models.rows.map((row) => ({
                id: row.model,
                name: row.model,
                requests: row.requests,
                inputTokens: row.inputTokens,
                outputTokens: row.outputTokens,
                cacheTokens: row.cacheTokens,
                cacheHitRate: row.cacheHitRate,
                averageDurationMs: row.averageDurationMs,
              }))}
            />
          </div>

          <footer className="board-footer">
            <span>{copy.refreshedAt}: {new Date(state.refreshedAt).toLocaleTimeString()}</span>
            <span>{copy.timezone}: {state.data.summary.timezone}</span>
            <span>{copy.groupFilter}: {selectedGroup ? selectedGroup.name : copy.allGroups}</span>
            <span>{copy.refreshEvery}: {appConfig.refreshSeconds} {copy.seconds}</span>
            <span>{rangeLabel(range, lang)}</span>
          </footer>
        </>
      )}
      </>
      )}

      {view === 'adoption' && (
        <AdoptionView
          state={adoptionState}
          lang={lang}
          onManageRoster={() => setRosterOpen(true)}
        />
      )}

      {rosterOpen && token ? (
        <RosterManagerDialog
          token={token}
          groupId={groupId}
          lang={lang}
          onClose={() => setRosterOpen(false)}
          onSaved={() => {
            setRosterOpen(false);
            setRosterRevision((revision) => revision + 1);
          }}
        />
      ) : null}
    </main>
  );
}
