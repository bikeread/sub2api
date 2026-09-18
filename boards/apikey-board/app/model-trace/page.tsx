'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { appConfig } from '@/lib/config';
import {
  createDetectionBatch,
  DEFAULT_PROMPT,
  type DetectionMethod,
  type DetectionRequest,
} from '@/lib/modeltrace/request';
import type {
  DetectionOutcome,
  HistoryEntry,
  Verdict,
} from '@/lib/modeltrace/types';
import {
  automaticModel,
  getModelCatalog,
  resolveSelection,
  reasoningLabel,
  type ModelCatalog,
} from '@/lib/modeltrace/options';
import './model-trace.css';

const TOKEN_STORAGE_KEY = 'apikey-board:admin-token';
const LABELS: Record<Verdict, string> = {
  ok: '正常',
  suspected_downgrade: '疑似降智',
  inconclusive: '无法判定',
};
type Account = {
  id: number;
  name: string;
  type: string;
  status: string;
  schedulable: boolean;
  last: HistoryEntry | null;
  lastPrompt: HistoryEntry | null;
  modelCatalog: ModelCatalog;
};
type Job = { status: 'queued' | 'running' | 'done' | 'failed'; error?: string };
type Progress = {
  total: number;
  completed: number;
  failed: number;
  current: string;
};
const api = (path: string) =>
  `${appConfig.boardBasePath}/api/model-trace/${path}`;
const message = (error: unknown) =>
  error instanceof Error ? error.message : '请求失败，请重试';
const formatTime = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { hour12: false });
const resultLabel = (entry: HistoryEntry) =>
  entry.method === 'prompt' ? '已完成，供人工判断' : LABELS[entry.verdict];

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok)
    throw new Error(payload?.error || `请求失败 HTTP ${response.status}`);
  return payload.data as T;
}

function ModelTraceBoard() {
  const params = useSearchParams();
  const rawToken = params.get('token');
  const [token, setToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<DetectionMethod>('fingerprint');
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [models, setModels] = useState<Record<number, string>>({});
  const [efforts, setEfforts] = useState<Record<number, string>>({});
  const [jobs, setJobs] = useState<Record<number, Job>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(0);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      /* Storage may be disabled. */
    }
    const value = rawToken?.trim() || saved || null;
    if (value) {
      try {
        window.sessionStorage.setItem(TOKEN_STORAGE_KEY, value);
      } catch {
        /* URL token still works. */
      }
    }
    setToken(value);
    setAuthReady(true);
  }, [rawToken]);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const data = await readResponse<{ accounts: Account[] }>(
        await fetch(api('accounts'), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
      );
      setAccounts(data.accounts);
      setSelectedId((previous) =>
        data.accounts.some((a) => a.id === previous)
          ? previous
          : (data.accounts[0]?.id ?? null),
      );
    } catch (err) {
      setError(message(err));
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setHistory([]);
    setHistoryIndex(0);
    setHistoryError(null);
    if (!token || selectedId === null) return;
    const controller = new AbortController();
    setHistoryLoading(true);
    void fetch(api(`history?account_id=${selectedId}&method=${method}`), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => readResponse<{ entries: HistoryEntry[] }>(response))
      .then((data) => {
        if (!controller.signal.aborted) setHistory(data.entries);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setHistoryError(message(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [token, selectedId, method, historyVersion]);

  const selections = Object.fromEntries(
    (accounts ?? []).map((account) => [
      account.id,
      resolveSelection(
        account.modelCatalog ?? getModelCatalog(),
        method,
        models[account.id],
        efforts[account.id],
      ),
    ]),
  );
  const run = async (targets: Account[]) => {
    if (!token || busyRef.current || !targets.length) return;
    const selectedModels = Object.fromEntries(
      targets.map((a) => [a.id, selections[a.id].model]),
    );
    const selectedEfforts = Object.fromEntries(
      targets.map((a) => [a.id, selections[a.id].effort]),
    );
    let batch: DetectionRequest[];
    try {
      batch = createDetectionBatch(
        targets.map((a) => a.id),
        selectedModels,
        method,
        prompt,
        selectedEfforts,
      );
    } catch (err) {
      const invalid = Object.fromEntries(
        targets.flatMap((a) => {
          try {
            createDetectionBatch(
              [a.id],
              selectedModels,
              method,
              prompt,
              selectedEfforts,
            );
            return [];
          } catch (failure) {
            return [
              [a.id, { status: 'failed' as const, error: message(failure) }],
            ];
          }
        }),
      );
      setJobs(invalid);
      setError(`尚未开始检测：${message(err)}`);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setJobs(
      Object.fromEntries(targets.map((a) => [a.id, { status: 'queued' }])),
    );
    setProgress({ total: batch.length, completed: 0, failed: 0, current: '' });
    try {
      for (const request of batch) {
        const account = targets.find((a) => a.id === request.account_id)!;
        setJobs((prev) => ({ ...prev, [account.id]: { status: 'running' } }));
        setProgress((prev) => prev && { ...prev, current: account.name });
        try {
          const outcome = await readResponse<DetectionOutcome>(
            await fetch(api('detect'), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(request),
            }),
          );
          setAccounts(
            (prev) =>
              prev?.map((a) =>
                a.id === account.id
                  ? {
                      ...a,
                      [request.method === 'prompt' ? 'lastPrompt' : 'last']:
                        outcome.entry,
                    }
                  : a,
              ) ?? null,
          );
          setJobs((prev) => ({ ...prev, [account.id]: { status: 'done' } }));
          setSelectedId(account.id);
          setHistoryVersion((prev) => prev + 1);
        } catch (err) {
          setJobs((prev) => ({
            ...prev,
            [account.id]: { status: 'failed', error: message(err) },
          }));
          setProgress((prev) => prev && { ...prev, failed: prev.failed + 1 });
        } finally {
          setProgress(
            (prev) => prev && { ...prev, completed: prev.completed + 1 },
          );
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress((prev) => prev && { ...prev, current: '' });
    }
  };

  const selectedAccount = accounts?.find((a) => a.id === selectedId);
  const latest = selectedAccount
    ? method === 'prompt'
      ? selectedAccount.lastPrompt
      : selectedAccount.last
    : null;
  const historical = history[historyIndex];
  const entry =
    historical?.accountId === selectedId &&
    (historical.method ?? 'fingerprint') === method
      ? historical
      : latest;
  const eligible =
    accounts?.filter(
      (a) => a.status === 'active' && selections[a.id].models.length > 0,
    ) ?? [];

  if (!authReady)
    return (
      <main className="trace-page">
        <p className="trace-empty">正在加载…</p>
      </main>
    );
  if (!token)
    return (
      <main className="trace-page">
        <p className="trace-empty">
          缺少管理员凭证，请从 Sub2API 后台的 Token 大屏进入。
        </p>
      </main>
    );

  return (
    <main className="trace-page">
      <header className="trace-header">
        <div>
          <a className="trace-back" href={appConfig.boardBasePath}>
            ← Token 大屏
          </a>
          <p className="trace-eyebrow">MODEL INSPECTION</p>
          <h1>降智检测</h1>
          <p className="trace-muted">
            按账号检查模型表现，让每一次判断都有回复可查。
          </p>
        </div>
        <div className="trace-header-stat">
          <strong>{accounts?.length ?? '—'}</strong>
          <span>OpenAI 账号</span>
        </div>
      </header>

      <section
        className="trace-panel trace-config"
        aria-labelledby="config-title"
      >
        <div className="trace-section-heading">
          <div>
            <span className="trace-step">01</span>
            <h2 id="config-title">检测配置</h2>
          </div>
          <span className="trace-muted">检测会消耗账号额度</span>
        </div>
        <div className="trace-config-row">
          <label className="trace-field">
            检测方式
            <select
              value={method}
              disabled={busy}
              onChange={(e) => {
                setMethod(e.target.value as DetectionMethod);
                setJobs({});
                setProgress(null);
                setError(null);
              }}
            >
              <option value="fingerprint">统计指纹检测</option>
              <option value="prompt">提示词检测（人工判断）</option>
            </select>
          </label>
          <p className="trace-method-description">
            {method === 'prompt'
              ? '发送一次提示词，阅读完整回复并自行判断。请为待测账号选择目标模型。'
              : '发送 3 条随机整数挑战，通过 ModelTrace 统计指纹归因。单次约 1–2 分钟，统计结论供排查参考。'}
          </p>
          <button
            className="trace-button trace-primary"
            disabled={busy || !eligible.length}
            onClick={() => void run(eligible)}
          >
            全部检测{eligible.length ? ` · ${eligible.length}` : ''}
          </button>
        </div>
        {method === 'prompt' && (
          <div className="trace-prompt-editor">
            <div className="trace-prompt-label">
              <label htmlFor="trace-prompt">检测提示词</label>
              <button
                className="trace-button trace-quiet"
                disabled={busy}
                onClick={() => setPrompt(DEFAULT_PROMPT)}
              >
                恢复默认题目
              </button>
            </div>
            <textarea
              id="trace-prompt"
              value={prompt}
              disabled={busy}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
            />
            <p className="trace-muted">
              默认：糖果配对题 · 将原样发送当前内容 · {prompt.length} 字符
            </p>
          </div>
        )}
        {progress && (
          <div className="trace-progress" role="status" aria-live="polite">
            <div>
              <strong>
                {busy
                  ? `正在检测：${progress.current || '准备中'}`
                  : '本轮检测结束'}
              </strong>
              <span>
                {progress.completed} / {progress.total} 已完成
                {progress.failed > 0 ? ` · ${progress.failed} 失败` : ''}
              </span>
            </div>
            <progress value={progress.completed} max={progress.total} />
          </div>
        )}
      </section>
      {error && (
        <div className="trace-error" role="alert">
          {error}{' '}
          <button
            className="trace-button trace-quiet"
            disabled={busy}
            onClick={() => void load()}
          >
            刷新账号
          </button>
        </div>
      )}

      <div className="trace-workspace">
        <section
          className="trace-panel trace-accounts"
          aria-labelledby="accounts-title"
        >
          <div className="trace-section-heading">
            <div>
              <span className="trace-step">02</span>
              <h2 id="accounts-title">账号列表</h2>
            </div>
            <button
              className="trace-button trace-quiet"
              disabled={busy}
              onClick={() => void load()}
            >
              刷新
            </button>
          </div>
          {!accounts && (
            <p className="trace-empty">
              {error ? '账号列表加载失败，请重试。' : '加载账号中…'}
            </p>
          )}
          {accounts?.length === 0 && (
            <p className="trace-empty">暂无 OpenAI 账号</p>
          )}
          <div className="trace-account-list">
            {accounts?.map((account) => {
              const last =
                method === 'prompt' ? account.lastPrompt : account.last;
              const job = jobs[account.id];
              return (
                <article
                  className={`trace-account ${selectedId === account.id ? 'is-selected' : ''}`}
                  key={account.id}
                >
                  <div className="trace-account-top">
                    <button
                      className="trace-account-name"
                      onClick={() => {
                        setSelectedId(account.id);
                        setHistoryIndex(0);
                      }}
                    >
                      {account.name}
                      <span>
                        #{account.id} · {account.type}
                      </span>
                    </button>
                    <span
                      className={`trace-badge ${account.status === 'active' && selections[account.id].models.length ? 'is-ok' : ''}`}
                    >
                      {account.status === 'active'
                        ? selections[account.id].models.length
                          ? '可检测'
                          : '待同步'
                        : account.status}
                    </span>
                  </div>
                  {!account.schedulable && (
                    <p className="trace-muted trace-account-note">
                      调度已关闭 · 检测时临时隔离，结束后恢复
                    </p>
                  )}
                  <div className="trace-account-controls">
                    <label className="trace-field">
                      {method === 'prompt' ? '目标模型' : '声明模型'}
                      <select
                        aria-label={`${account.name}的目标模型`}
                        value={selections[account.id].model}
                        disabled={busy}
                        onChange={(e) => {
                          setModels((prev) => ({
                            ...prev,
                            [account.id]: e.target.value,
                          }));
                          setEfforts((prev) => ({ ...prev, [account.id]: '' }));
                        }}
                      >
                        <option value="">
                          {method === 'prompt'
                            ? '请选择目标模型'
                            : `自动${automaticModel(selections[account.id].models) ? `（${automaticModel(selections[account.id].models)}）` : '（无可归因模型）'}`}
                        </option>
                        {selections[account.id].models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="trace-field">
                      思维强度
                      <select
                        aria-label={`${account.name}的思维强度`}
                        value={selections[account.id].effort}
                        disabled={
                          busy || !selections[account.id].efforts.length
                        }
                        onChange={(e) =>
                          setEfforts((prev) => ({
                            ...prev,
                            [account.id]: e.target.value,
                          }))
                        }
                      >
                        <option value="">跟随模型默认</option>
                        {selections[account.id].efforts.map((effort) => (
                          <option key={effort} value={effort}>
                            {reasoningLabel(effort)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="trace-button"
                      disabled={
                        busy ||
                        account.status !== 'active' ||
                        !selections[account.id].models.length
                      }
                      onClick={() => void run([account])}
                    >
                      {job?.status === 'running'
                        ? '检测中…'
                        : job?.status === 'queued'
                          ? '等待中'
                          : job?.status === 'failed'
                            ? '重试'
                            : '开始检测'}
                    </button>
                  </div>
                  {account.modelCatalog?.source !== 'account' && (
                    <p className="trace-muted trace-account-note">
                      未保存模型能力数据，请在账号管理中同步后刷新。
                    </p>
                  )}
                  {job?.error && (
                    <p className="trace-inline-error" role="alert">
                      {job.error}
                    </p>
                  )}
                  <button
                    className="trace-last"
                    onClick={() => {
                      setSelectedId(account.id);
                      setHistoryIndex(0);
                    }}
                    disabled={!last}
                  >
                    <span
                      className={`trace-result-dot ${last?.method === 'prompt' ? 'is-manual' : last ? `is-${last.verdict}` : ''}`}
                    />
                    <span>{last ? resultLabel(last) : '尚未检测'}</span>
                    {last && <time>{formatTime(last.detectedAt)}</time>}
                    <span aria-hidden="true">↗</span>
                  </button>
                </article>
              );
            })}
          </div>
        </section>

        <section
          className="trace-panel trace-results"
          aria-labelledby="results-title"
        >
          <div className="trace-section-heading">
            <div>
              <span className="trace-step">03</span>
              <h2 id="results-title">结果详情</h2>
            </div>
            <span className="trace-muted">
              {selectedAccount?.name ?? '选择账号'}
            </span>
          </div>
          {historyError && (
            <p className="trace-inline-error" role="alert">
              历史加载失败：{historyError}{' '}
              <button
                className="trace-button trace-quiet"
                onClick={() => setHistoryVersion((v) => v + 1)}
              >
                重试
              </button>
            </p>
          )}
          {historyLoading && (
            <p className="trace-muted" role="status">
              正在读取历史…
            </p>
          )}
          {history.length > 0 && (
            <label className="trace-field trace-history-picker">
              检测记录（最近 {history.length} 次）
              <select
                value={historyIndex}
                onChange={(e) => setHistoryIndex(Number(e.target.value))}
              >
                {history.map((item, index) => (
                  <option key={`${item.detectedAt}-${index}`} value={index}>
                    {formatTime(item.detectedAt)} · {item.model}
                  </option>
                ))}
              </select>
            </label>
          )}
          {entry ? (
            <ResultDetail
              key={`${entry.accountId}-${entry.method}-${entry.detectedAt}`}
              entry={entry}
            />
          ) : (
            <div className="trace-empty trace-result-empty">
              <span className="trace-empty-icon" aria-hidden="true">
                ◎
              </span>
              <h3>等待一次检测</h3>
              <p>选择检测方式并运行账号，结果将在这里展示。</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState('');
  return (
    <span className="trace-copy">
      <button
        className="trace-button trace-quiet"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setStatus('已复制');
          } catch {
            setStatus('复制失败，请选中文本复制');
          }
        }}
      >
        {label}
      </button>
      <span role="status">{status}</span>
    </span>
  );
}

function ResultDetail({ entry }: { entry: HistoryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const manual = entry.method === 'prompt';
  return (
    <div className="trace-detail">
      <div
        className={`trace-verdict ${manual ? 'is-manual' : `is-${entry.verdict}`}`}
      >
        <span>{manual ? '提示词检测' : '统计指纹检测'}</span>
        <h3>{resultLabel(entry)}</h3>
        {!manual && <p>{entry.reason}</p>}
      </div>
      <dl className="trace-metadata">
        <div>
          <dt>请求模型</dt>
          <dd>{entry.model}</dd>
        </div>
        <div>
          <dt>请求思维强度</dt>
          <dd>
            {entry.reasoningEffort
              ? reasoningLabel(entry.reasoningEffort)
              : '跟随模型默认'}
          </dd>
        </div>
        <div>
          <dt>耗时</dt>
          <dd>
            {entry.durationMs == null
              ? '历史未记录'
              : `${(entry.durationMs / 1000).toFixed(1)} 秒`}
          </dd>
        </div>
        <div>
          <dt>检测时间</dt>
          <dd>{formatTime(entry.detectedAt)}</dd>
        </div>
      </dl>
      {entry.method === 'prompt' ? (
        <>
          {entry.finishReason === 'length' && (
            <p className="trace-warning" role="status">
              回复达到输出上限，内容可能被截断，请勿将不完整回复当作完整作答。
            </p>
          )}
          <details className="trace-sent-prompt">
            <summary>本次发送的提示词</summary>
            <CopyButton text={entry.prompt} label="复制提示词" />
            <pre>{entry.prompt}</pre>
          </details>
          <div className="trace-output-heading">
            <h3>模型回复</h3>
            <CopyButton text={entry.output} label="复制回复" />
          </div>
          <pre className={`trace-output ${expanded ? 'is-expanded' : ''}`}>
            {entry.output}
          </pre>
          <div className="trace-output-footer">
            <button
              className="trace-button trace-quiet"
              aria-expanded={expanded}
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? '收起回复' : '展开完整阅读'}
            </button>
            <span>结束原因：{entry.finishReason ?? '未返回'}</span>
          </div>
        </>
      ) : (
        <>
          <div className="trace-fingerprint-summary">
            <div>
              <span>归因模型</span>
              <strong>{entry.prediction || '—'}</strong>
            </div>
            <div>
              <span>归因概率</span>
              <strong>
                {(entry.probability * 100).toFixed(1)}
                <small>%</small>
              </strong>
            </div>
          </div>
          <div className="trace-bars">
            {(entry.attribution?.top ?? entry.top).map((item) => (
              <div className="trace-bar" key={item.model}>
                <div>
                  <span>
                    {'displayName' in item
                      ? String(item.displayName)
                      : item.model}
                  </span>
                  <strong>{(item.probability * 100).toFixed(1)}%</strong>
                </div>
                <div className="trace-bar-track">
                  <span
                    style={{
                      width: `${Math.max(0, Math.min(100, item.probability * 100))}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <details className="trace-diagnostics">
            <summary>查看检测依据 · 有效回答 {entry.usedOutputs}/3</summary>
            {entry.attribution ? (
              <>
                <p>
                  GPT 家族概率：
                  {(entry.attribution.familyProbability * 100).toFixed(1)}%
                </p>
                <ul>
                  {entry.attribution.diagnostics.map((d) => (
                    <li key={d.index}>
                      挑战 {d.index + 1}：解析 {d.parsedNumbers} 个数字，最低{' '}
                      {d.minimumNumbers} 个 · {d.accepted ? '有效' : '未采纳'}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>这条历史记录未保存逐题解析详情。</p>
            )}
          </details>
        </>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ModelTraceBoard />
    </Suspense>
  );
}
