'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { appConfig } from '@/lib/config';
import { rangeLabel } from '@/lib/range';
import type {
  BoardRange,
  GroupsPayload,
  GroupOption,
  ModelStatsPayload,
  RankingPayload,
  SummaryPayload,
} from '@/lib/types';

type BoardData = {
  summary: SummaryPayload;
  ranking: RankingPayload;
  models: ModelStatsPayload;
};

type ViewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: BoardData; refreshedAt: string };

const TOKEN_STORAGE_KEY = 'apikey-board:admin-token';

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
      avgLatency: '平均延迟',
      totalTokens: '总 Token',
      keyStats: '密钥统计',
      keyStatsHint: '按密钥名称查看请求量与 Token 消耗',
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
      avgLatency: 'Avg Latency',
      totalTokens: 'Total Tokens',
      keyStats: 'Key Stats',
      keyStatsHint: 'Request volume and token usage by API key name',
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
    },
  }[lang];
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatPercent(value: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;
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

function useBoardData(range: BoardRange, token: string | null, groupId: number | null) {
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
        const [summary, ranking, models] = await Promise.all([
          getJson<SummaryPayload>('/api/summary', token, range, groupId),
          getJson<RankingPayload>('/api/ranking', token, range, groupId),
          getJson<ModelStatsPayload>('/api/models', token, range, groupId),
        ]);
        if (!cancelled && mountedRef.current) {
          setState({ kind: 'ready', data: { summary, ranking, models }, refreshedAt: new Date().toISOString() });
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
  }, [range, token, groupId]);

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

export function APIKeyBoard() {
  const searchParams = useSearchParams();
  const lang = readLang(searchParams.get('lang'));
  const theme = readTheme(searchParams.get('theme'));
  const copy = copyFor(lang);
  const token = usePersistedToken(searchParams.get('token'));
  const [range, setRange] = useState<BoardRange>('today');
  const [groupId, setGroupId] = useState<number | null>(null);
  const { groups, error: groupsError } = useGroups(token, lang);
  const state = useBoardData(range, token, groupId);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
          <h1 className="board-title">{copy.title}</h1>
          <p className="board-subtitle">{copy.subtitle}</p>
        </div>
        <div className="board-header__right">
          <span className="board-timestamp">
            {copy.refreshedAt}: {state.kind === 'ready' ? new Date(state.refreshedAt).toLocaleTimeString() : '—'}
          </span>
          <div className="board-controls">
            <label className="group-filter">
              <span>{copy.groupFilter}</span>
              <select
                value={groupId ?? 'all'}
                onChange={(event) => {
                  const value = event.target.value;
                  setGroupId(value === 'all' ? null : Number(value));
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
          </div>
          {groupsError ? <span className="board-control-error">{copy.groupsUnavailable}</span> : null}
        </div>
      </header>

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
              detail={`${copy.avgLatency} ${formatDuration(state.data.summary.averageDurationMs, lang)}`}
              accent="var(--c-rose)"
            />
          </section>

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
    </main>
  );
}
