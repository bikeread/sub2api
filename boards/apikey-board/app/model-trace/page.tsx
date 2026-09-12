'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const TOKEN_STORAGE_KEY = 'apikey-board:admin-token';

type Verdict = 'ok' | 'suspected_downgrade' | 'inconclusive';

type LastResult = {
  verdict: Verdict;
  reason: string;
  prediction: string;
  probability: number;
  model: string;
  detectedAt: string;
};

type AccountRow = {
  id: number;
  name: string;
  type: string;
  status: string;
  schedulable: boolean;
  last: LastResult | null;
};

type DetectResult = {
  entry: LastResult & { top: { model: string; probability: number }[] };
  attribution: {
    top: { model: string; displayName: string; probability: number }[];
    usedOutputs: number;
    diagnostics: {
      index: number;
      parsedNumbers: number;
      minimumNumbers: number;
      accepted: boolean;
    }[];
    familyProbability: number;
  };
};

const VERDICT_LABEL: Record<Verdict, string> = {
  ok: '正常',
  suspected_downgrade: '疑似降智',
  inconclusive: '无法判定',
};

const VERDICT_COLOR: Record<Verdict, string> = {
  ok: '#22c55e',
  suspected_downgrade: '#ef4444',
  inconclusive: '#9ca3af',
};

function useToken(raw: string | null): string | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const persisted = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    const normalized = raw?.trim() || persisted || null;
    if (normalized) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, normalized);
      setToken(normalized);
    }
  }, [raw]);
  return token;
}

function ModelTraceBoard() {
  const searchParams = useSearchParams();
  const token = useToken(searchParams.get('token'));
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<Set<number>>(new Set());
  const [models, setModels] = useState<Map<number, string>>(new Map());
  const [results, setResults] = useState<Map<number, DetectResult>>(new Map());
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch('api/model-trace/accounts', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setAccounts(payload.data.accounts);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const detect = useCallback(
    async (accountId: number) => {
      if (!token) return;
      setRunning((prev) => new Set(prev).add(accountId));
      try {
        const response = await fetch('api/model-trace/detect', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            account_id: accountId,
            model: models.get(accountId) || '',
          }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        setResults((prev) => new Map(prev).set(accountId, payload.data));
        setExpanded(accountId);
        void load();
      } catch (err) {
        alert(err instanceof Error ? err.message : '检测失败');
      } finally {
        setRunning((prev) => {
          const next = new Set(prev);
          next.delete(accountId);
          return next;
        });
      }
    },
    [token, models, load],
  );

  const detectAll = useCallback(async () => {
    if (!accounts) return;
    for (const account of accounts) {
      if (account.status === 'active') {
        // eslint-disable-next-line no-await-in-loop
        await detect(account.id);
      }
    }
  }, [accounts, detect]);

  if (!token) {
    return <main style={styles.page}><p style={styles.muted}>缺少 admin token（从 Sub2API 后台自定义菜单进入，或 URL 携带 ?token=）</p></main>;
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>降智检测</h1>
          <p style={styles.muted}>
            对账号发送 3 条随机整数挑战，用统计指纹归因实际服务的模型（ModelTrace 方法）。单次约 1–2 分钟，会消耗账号少量额度。
          </p>
        </div>
        <button
          style={styles.primaryButton}
          disabled={running.size > 0 || !accounts?.length}
          onClick={() => void detectAll()}
        >
          全部检测
        </button>
      </header>

      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      {!accounts && !error && <p style={styles.muted}>加载账号中…</p>}

      {accounts && (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>账号</th>
              <th style={styles.th}>状态</th>
              <th style={styles.th}>声明模型</th>
              <th style={styles.th}>上次结论</th>
              <th style={styles.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => {
              const last = results.get(account.id)?.entry ?? account.last;
              const isRunning = running.has(account.id);
              return (
                <FragmentRow
                  key={account.id}
                  account={account}
                  last={last}
                  detail={results.get(account.id) ?? null}
                  expanded={expanded === account.id}
                  isRunning={isRunning}
                  model={models.get(account.id) ?? ''}
                  onModelChange={(value) =>
                    setModels((prev) => new Map(prev).set(account.id, value))
                  }
                  onDetect={() => void detect(account.id)}
                  onToggle={() => setExpanded(expanded === account.id ? null : account.id)}
                />
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}

function FragmentRow(props: {
  account: AccountRow;
  last: LastResult | null;
  detail: DetectResult | null;
  expanded: boolean;
  isRunning: boolean;
  model: string;
  onModelChange: (value: string) => void;
  onDetect: () => void;
  onToggle: () => void;
}) {
  const { account, last, detail, expanded, isRunning } = props;
  return (
    <>
      <tr>
        <td style={styles.td}>
          <div style={{ fontWeight: 600 }}>{account.name}</div>
          <div style={{ ...styles.muted, fontSize: 12 }}>#{account.id} · {account.type}</div>
        </td>
        <td style={styles.td}>
          <span style={{ color: account.status === 'active' ? '#22c55e' : '#9ca3af' }}>
            {account.status}
          </span>
          {!account.schedulable && (
            <span style={{ ...styles.muted, fontSize: 12, marginLeft: 6 }}>
              （调度已关，检测将自动绕过）
            </span>
          )}
        </td>
        <td style={styles.td}>
          <input
            style={styles.input}
            value={props.model}
            placeholder="自动（最强可归因模型）"
            onChange={(event) => props.onModelChange(event.target.value)}
          />
        </td>
        <td style={styles.td}>
          {last ? (
            <button style={styles.linkButton} onClick={props.onToggle}>
              <span style={{ color: VERDICT_COLOR[last.verdict], fontWeight: 600 }}>
                {VERDICT_LABEL[last.verdict]}
              </span>
              <span style={{ ...styles.muted, marginLeft: 8, fontSize: 12 }}>
                {new Date(last.detectedAt).toLocaleString('zh-CN', { hour12: false })}
              </span>
            </button>
          ) : (
            <span style={styles.muted}>未检测</span>
          )}
        </td>
        <td style={styles.td}>
          <button
            style={styles.primaryButton}
            disabled={isRunning || account.status !== 'active'}
            onClick={props.onDetect}
          >
            {isRunning ? '检测中…' : '检测降智'}
          </button>
        </td>
      </tr>
      {expanded && detail && (
        <tr>
          <td colSpan={5} style={{ ...styles.td, background: 'rgba(148,163,184,0.06)' }}>
            <div style={{ padding: '8px 4px' }}>
              <p style={{ margin: '0 0 8px' }}>{detail.entry.reason}</p>
              {detail.attribution.top.map((item) => (
                <div key={item.model} style={styles.barRow}>
                  <span style={styles.barLabel}>{item.displayName}</span>
                  <span style={styles.barTrack}>
                    <span
                      style={{
                        ...styles.barFill,
                        width: `${Math.round(item.probability * 100)}%`,
                        background:
                          item.model === detail.entry.model ? '#38bdf8' : '#64748b',
                      }}
                    />
                  </span>
                  <span style={styles.barValue}>{(item.probability * 100).toFixed(1)}%</span>
                </div>
              ))}
              <p style={{ ...styles.muted, fontSize: 12, marginTop: 8 }}>
                有效回答 {detail.attribution.usedOutputs}/3 ·
                解析数字 {detail.attribution.diagnostics.map((d) => d.parsedNumbers).join(' / ')} ·
                GPT 家族概率 {(detail.attribution.familyProbability * 100).toFixed(1)}%
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0b1220',
    color: '#e2e8f0',
    padding: '32px clamp(16px, 4vw, 48px)',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 24,
  },
  title: { margin: '0 0 8px', fontSize: 24 },
  muted: { color: '#94a3b8', margin: 0 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    borderBottom: '1px solid rgba(148,163,184,0.25)',
    color: '#94a3b8',
    fontSize: 13,
  },
  td: { padding: '12px', borderBottom: '1px solid rgba(148,163,184,0.12)' },
  input: {
    background: 'rgba(15,23,42,0.8)',
    border: '1px solid rgba(148,163,184,0.35)',
    borderRadius: 6,
    color: '#e2e8f0',
    padding: '6px 10px',
    width: 160,
  },
  primaryButton: {
    background: '#2563eb',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    cursor: 'pointer',
    padding: '7px 16px',
    fontSize: 14,
  },
  linkButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    textAlign: 'left',
  },
  barRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 },
  barLabel: { width: 220, fontSize: 13 },
  barTrack: {
    flex: 1,
    height: 10,
    background: 'rgba(148,163,184,0.15)',
    borderRadius: 5,
    overflow: 'hidden',
  },
  barFill: { display: 'block', height: '100%', borderRadius: 5 },
  barValue: { width: 56, textAlign: 'right', fontSize: 13 },
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ModelTraceBoard />
    </Suspense>
  );
}
