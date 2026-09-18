'use client';

import { useMemo, useState } from 'react';

import { appConfig } from '@/lib/config';
import type {
  QuotaProjectionPayload,
  QuotaProjectionState,
  QuotaProjectionView,
  QuotaVerdict,
} from '@/lib/types';

export interface QuotaProjectionLabels {
  title: string;
  hint: string;
  noData: string;
  observed: string;
  projected: string;
  ceiling: string;
  resetMarker: string;
  nowMarker: string;
  estimation: string;
  rateLabel: string;
  perPercentLabel: string;
  exhaustEstimate: string;
  atResetEstimate: string;
  verdicts: Record<QuotaVerdict, string>;
  states: Record<QuotaProjectionState, string>;
}

const WIDTH = 960;
const HEIGHT = 320;
const MARGIN = { top: 26, right: 30, bottom: 36, left: 56 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const Y_TICKS = [0, 25, 50, 75, 100];
const Y_MAX = 110;
const HOUR_MS = 3_600_000;
/** 相邻刻度至少留这么多像素，否则标签会叠在一起 */
const TICK_MIN_GAP_PX = 118;
const SERIES_COLORS = [
  'var(--c-blue)',
  'var(--c-teal)',
  'var(--c-violet)',
  'var(--c-amber)',
  'var(--c-rose)',
];

const markFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: appConfig.timezone,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatMark(ms: number): string {
  const parts = markFormatter.formatToParts(new Date(ms));
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

function formatTick(ms: number, withTime: boolean): string {
  const parts = markFormatter.formatToParts(new Date(ms));
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = `${pick('month')}-${pick('day')}`;
  return withTime ? `${day} ${pick('hour')}:00` : day;
}

/**
 * 按**时间**均匀取刻度，而不是按下标。
 * 下标法会在历史点密集处（整点桶挤在左侧）堆出一串重叠标签。
 */
function buildTimeTicks(
  domain: { min: number; max: number },
  xOf: (ts: number) => number,
): { ts: number; withTime: boolean }[] {
  const span = domain.max - domain.min;
  if (!Number.isFinite(span) || span <= 0) return [];

  const maxTicks = Math.max(2, Math.min(6, Math.floor(PLOT_WIDTH / TICK_MIN_GAP_PX)));
  const out: number[] = [];
  for (let i = 0; i < maxTicks; i += 1) {
    const raw = domain.min + (span * i) / (maxTicks - 1);
    // 数据本身是整点桶，刻度吸附到整点更好看
    const ts = i === 0 ? domain.min : Math.round(raw / HOUR_MS) * HOUR_MS;
    const x = xOf(ts);
    if (x < MARGIN.left + 12 || x > WIDTH - MARGIN.right - 24) continue;
    const previous = out[out.length - 1];
    if (previous !== undefined && x - xOf(previous) < TICK_MIN_GAP_PX) continue;
    out.push(ts);
  }
  return out.map((ts) => ({ ts, withTime: span <= 48 * HOUR_MS }));
}

function percentText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${Math.round(value)}%`;
}

function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.round(value)}`;
}

/** 只画得出来的账号：有历史点。其余在"数据不足"里说明。 */
function chartableViews(views: QuotaProjectionView[]): QuotaProjectionView[] {
  return views.filter((view) => view.history.length > 0);
}

export function QuotaProjectionChart({
  payload,
  labels,
}: {
  payload: QuotaProjectionPayload;
  labels: QuotaProjectionLabels;
}) {
  const [hoveredTs, setHoveredTs] = useState<number | null>(null);
  const views = chartableViews(payload.views);

  const nowMs = useMemo(() => new Date(payload.generatedAt).getTime(), [payload.generatedAt]);

  const domain = useMemo(() => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const view of views) {
      if (view.windowStartMs !== null) min = Math.min(min, view.windowStartMs);
      if (view.history.length > 0) min = Math.min(min, view.history[0].ts);
      if (view.resetAtMs !== null) max = Math.max(max, view.resetAtMs);
      for (const point of view.history) max = Math.max(max, point.ts);
      for (const point of view.forecast) max = Math.max(max, point.ts);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
    return { min, max };
  }, [views]);

  const marks = useMemo(() => {
    const set = new Set<number>();
    for (const view of views) {
      for (const point of view.history) set.add(point.ts);
      for (const point of view.forecast) set.add(point.ts);
    }
    set.add(nowMs);
    return [...set].filter((ts) => Number.isFinite(ts)).sort((a, b) => a - b);
  }, [views, nowMs]);

  const pointX = (ts: number) =>
    domain === null || domain.max === domain.min
      ? MARGIN.left + PLOT_WIDTH / 2
      : MARGIN.left + ((ts - domain.min) / (domain.max - domain.min)) * PLOT_WIDTH;
  const pointY = (percent: number) =>
    MARGIN.top + PLOT_HEIGHT - (Math.min(percent, Y_MAX) / Y_MAX) * PLOT_HEIGHT;

  const resetMarkers = useMemo(() => {
    const seen: number[] = [];
    for (const view of views) {
      if (view.resetAtMs === null) continue;
      if (!seen.some((ts) => Math.abs(ts - view.resetAtMs!) < 30 * 60_000)) {
        seen.push(view.resetAtMs);
      }
    }
    return seen.sort((a, b) => a - b);
  }, [views]);

  const insufficient = payload.views.filter((view) => view.history.length === 0);

  if (domain === null || views.length === 0) {
    return (
      <section className="trend-card">
        <ChartHeading labels={labels} />
        <div className="empty-state">{labels.noData}</div>
      </section>
    );
  }

  const ticks = buildTimeTicks(domain, pointX);

  const hoveredPercentAt = (view: QuotaProjectionView): number | null => {
    if (hoveredTs === null) return null;
    let found: number | null = null;
    for (const point of view.history) {
      if (point.ts <= hoveredTs) found = point.percent;
      else break;
    }
    if (found === null && view.forecast.length > 0) found = view.forecast[0].percent;
    return found;
  };

  return (
    <section className="trend-card">
      <ChartHeading labels={labels} />

      <div className="trend-legend">
        {views.map((view, index) => {
          const color = SERIES_COLORS[index % SERIES_COLORS.length];
          return (
            <span
              key={view.accountId}
              className="trend-legend__item trend-legend__item--static"
              style={{ ['--series-color' as string]: color }}
            >
              <i />
              <strong>{view.accountName || `account-${view.accountId}`}</strong>
              <span className={`verdict-badge verdict-badge--${view.verdict}`}>
                {labels.verdicts[view.verdict]}
              </span>
              {view.verdict !== 'unknown' ? (
                <small>
                  {view.exhaustAtMs !== null && view.exhaustAtMs < (view.resetAtMs ?? Infinity)
                    ? `${labels.exhaustEstimate} ${formatMark(view.exhaustAtMs)}`
                    : `${labels.atResetEstimate} ${percentText(view.percentAtReset)}`}
                </small>
              ) : null}
              <small>{`${labels.rateLabel} ${view.ratePerHour.toFixed(2)}%/h · ${view.lookbackHours}h`}</small>
            </span>
          );
        })}
      </div>

      <div className="trend-chart__canvas">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={labels.title}
          onMouseLeave={() => setHoveredTs(null)}
        >
          {Y_TICKS.map((tick) => (
            <g className="trend-grid" key={tick}>
              <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={pointY(tick)} y2={pointY(tick)} />
              <text x={MARGIN.left - 8} y={pointY(tick) + 4} textAnchor="end">
                {tick}%
              </text>
            </g>
          ))}

          {/* 100% 额度上限 */}
          <line
            className="trend-ceiling"
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={pointY(100)}
            y2={pointY(100)}
          />

          {ticks.map(({ ts, withTime }) => (
            <g className="trend-grid" key={`x-${ts}`}>
              <line x1={pointX(ts)} x2={pointX(ts)} y1={MARGIN.top} y2={MARGIN.top + PLOT_HEIGHT} />
              <text x={pointX(ts)} y={HEIGHT - MARGIN.bottom + 18} textAnchor="middle">
                {formatTick(ts, withTime)}
              </text>
            </g>
          ))}

          {resetMarkers.map((ts) => (
            <line
              key={`reset-${ts}`}
              className="trend-marker trend-marker--reset"
              x1={pointX(ts)}
              x2={pointX(ts)}
              y1={MARGIN.top}
              y2={MARGIN.top + PLOT_HEIGHT}
            />
          ))}
          <line
            className="trend-marker trend-marker--now"
            x1={pointX(nowMs)}
            x2={pointX(nowMs)}
            y1={MARGIN.top}
            y2={MARGIN.top + PLOT_HEIGHT}
          />

          {views.map((view, index) => {
            const color = SERIES_COLORS[index % SERIES_COLORS.length];
            const historyPath = view.history
              .map((point, i) => `${i === 0 ? 'M' : 'L'}${pointX(point.ts)},${pointY(point.percent)}`)
              .join(' ');
            const forecastPath = view.forecast
              .map((point, i) => `${i === 0 ? 'M' : 'L'}${pointX(point.ts)},${pointY(point.percent)}`)
              .join(' ');
            return (
              <g className="trend-series" key={view.accountId} style={{ ['--series-color' as string]: color }}>
                <path d={historyPath} fill="none" />
                <path className="trend-series--forecast" d={forecastPath} fill="none" />
              </g>
            );
          })}

          {marks.map((ts) => (
            <rect
              key={`hit-${ts}`}
              className="trend-hit-point"
              x={pointX(ts) - 6}
              y={MARGIN.top}
              width={12}
              height={PLOT_HEIGHT}
              onMouseEnter={() => setHoveredTs(ts)}
            />
          ))}
        </svg>

        {hoveredTs !== null ? (
          <div
            className="trend-tooltip"
            style={{
              left: `${(pointX(hoveredTs) / WIDTH) * 100}%`,
              ['--tooltip-color' as string]: SERIES_COLORS[0],
            }}
          >
            <strong>{formatMark(hoveredTs)}</strong>
            {views.map((view, index) => (
              <span key={view.accountId}>
                {view.accountName || `account-${view.accountId}`}
                <b style={{ color: SERIES_COLORS[index % SERIES_COLORS.length] }}>
                  {percentText(hoveredPercentAt(view))}
                </b>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="trend-footnote">
        <span>
          <i className="trend-marker-legend trend-marker-legend--reset" />
          {labels.resetMarker}
        </span>
        <span>
          <i className="trend-marker-legend trend-marker-legend--now" />
          {labels.nowMarker}
        </span>
        <span>
          <i className="trend-marker-legend trend-marker-legend--ceiling" />
          {labels.ceiling}
        </span>
        <span className="is-muted">{labels.estimation}</span>
      </div>

      {insufficient.length > 0 ? (
        <ul className="trend-notes">
          {insufficient.map((view) => (
            <li key={view.accountId}>
              <strong>{view.accountName || `account-${view.accountId}`}</strong>
              <span>{labels.states[view.state]}</span>
              {view.tokensPerPercent !== null ? (
                <small>{`${labels.perPercentLabel} ${compactNumber(view.tokensPerPercent)}`}</small>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ChartHeading({ labels }: { labels: QuotaProjectionLabels }) {
  return (
    <div className="trend-card__topline">
      <div className="section-heading">
        <p className="section-heading__eyebrow">{labels.title}</p>
        <h2>{labels.hint}</h2>
      </div>
      <div className="trend-legend__item trend-legend__item--static">
        <span>{labels.observed}</span>
        <span>{labels.projected}</span>
      </div>
    </div>
  );
}
