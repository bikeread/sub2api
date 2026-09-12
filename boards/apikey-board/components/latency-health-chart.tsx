'use client';

import { useState, type ReactNode } from 'react';

import { formatInteger } from '@/lib/format';
import {
  formatLatencyTick,
  formatLatencyValue,
  latencyYDomain,
  splitSeries,
  trimTrailingEmptyBuckets,
  xTickIndexes,
  type LatencyLang,
} from '@/lib/latency-chart';
import type {
  LatencyAccountSeries,
  LatencyErrorGroup,
  LatencyHealthPayload,
} from '@/lib/types';

export type LatencyChartLabels = {
  title: string;
  hint: string;
  noData: string;
  p50: string;
  p95: string;
  p99: string;
  slow: string;
  errors: string;
  requests: string;
};

const CHART_WIDTH = 960;
const CHART_HEIGHT = 320;
const MARGIN = { top: 26, right: 30, bottom: 36, left: 66 };
const PLOT_WIDTH = CHART_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

const PERCENTILE_SERIES = [
  { key: 'p50', color: 'var(--c-blue)', width: 1.6 },
  { key: 'p95', color: 'var(--c-amber)', width: 2.2 },
  { key: 'p99', color: 'var(--c-rose)', width: 2.8 },
] as const;

const ACCOUNT_COLORS = ['var(--c-teal)', 'var(--c-violet)', '#38bdf8', '#f472b6', '#a3e635'];

const SLOW_BAR_COLOR = 'rgba(244, 63, 94, 0.18)';
const ERROR_MARK_COLOR = '#ef4444';
const SLOW_BAR_MAX_HEIGHT = 26;

type SeriesDef = {
  key: string;
  color: string;
  width: number;
  dashed: boolean;
  legendLabel: ReactNode;
  values: (number | null)[];
};

function accountDisplayName(series: LatencyAccountSeries) {
  return series.accountName.trim() || `account-${series.accountId}`;
}

function Legend({
  series,
  labels,
  hoveredKey,
  onHover,
}: {
  series: SeriesDef[];
  labels: LatencyChartLabels;
  hoveredKey: string | null;
  onHover: (key: string | null) => void;
}) {
  return (
    <div className="trend-legend" onMouseLeave={() => onHover(null)}>
      {series.map((item) => (
        <button
          key={item.key}
          type="button"
          className={hoveredKey && hoveredKey !== item.key ? 'trend-legend__item is-muted' : 'trend-legend__item'}
          style={{ ['--series-color' as string]: item.color }}
          onMouseEnter={() => onHover(item.key)}
          onFocus={() => onHover(item.key)}
          onBlur={() => onHover(null)}
        >
          <span>{item.legendLabel}</span>
        </button>
      ))}
      <span className="trend-legend__item trend-legend__item--static">
        <span>{labels.slow}</span>
      </span>
      <span className="trend-legend__item trend-legend__item--static">
        <span>{labels.errors}</span>
      </span>
    </div>
  );
}

function SeriesLayer({
  series,
  hoveredKey,
  pointX,
  pointY,
}: {
  series: SeriesDef[];
  hoveredKey: string | null;
  pointX: (index: number) => number;
  pointY: (value: number | null) => number | null;
}) {
  return (
    <g className="trend-lines">
      {series.map((item) => {
        const { segments, dots } = splitSeries(item.values);
        const path = segments
          .map(([start, end]) => {
            const coords: string[] = [];
            for (let index = start; index <= end; index += 1) {
              const y = pointY(item.values[index]);
              if (y === null) continue;
              coords.push(`${pointX(index).toFixed(2)} ${y.toFixed(2)}`);
            }
            return coords.length > 0 ? `M${coords.join(' L')}` : '';
          })
          .filter(Boolean)
          .join(' ');
        const muted = hoveredKey !== null && hoveredKey !== item.key;
        return (
          <g
            key={item.key}
            className={muted ? 'trend-series is-muted' : 'trend-series'}
            style={{ ['--series-color' as string]: item.color }}
          >
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={item.dashed
                ? { strokeWidth: item.width, strokeDasharray: '4 4' }
                : { strokeWidth: item.width }}
            />
            {dots.map((index) => {
              const y = pointY(item.values[index]);
              if (y === null) return null;
              return (
                <circle
                  key={`${item.key}-dot-${index}`}
                  cx={pointX(index)}
                  cy={y}
                  r={item.dashed ? 2.2 : 2.6}
                  fill="currentColor"
                />
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

function ChartTooltip({
  index,
  buckets,
  accounts,
  errors,
  labels,
  lang,
  x,
}: {
  index: number;
  buckets: LatencyHealthPayload['points'];
  accounts: LatencyAccountSeries[];
  errors: LatencyErrorGroup[];
  labels: LatencyChartLabels;
  lang: LatencyLang;
  x: number;
}) {
  const point = buckets[index];
  if (!point) return null;
  const errorGroup = errors.find((group) => group.bucket === point.bucket) ?? null;
  return (
    <div
      className="trend-tooltip"
      style={{
        ['--tooltip-color' as string]: '#f59e0b',
        left: `${(x / CHART_WIDTH) * 100}%`,
        top: `${(MARGIN.top / CHART_HEIGHT) * 100}%`,
      }}
    >
      <span>{point.label}</span>
      <small>{labels.p50}: {formatLatencyValue(point.p50, lang)}</small>
      <small>{labels.p95}: {formatLatencyValue(point.p95, lang)}</small>
      <small>{labels.p99}: {formatLatencyValue(point.p99, lang)}</small>
      <small>{labels.requests}: {formatInteger(point.requests)}</small>
      <small>{labels.slow}: {formatInteger(point.slowCount)}</small>
      {accounts.map((account) => (
        <small key={account.accountId ?? account.accountName}>
          {accountDisplayName(account)} {labels.p95}: {formatLatencyValue(account.points[index]?.p95 ?? null, lang)}
        </small>
      ))}
      {errorGroup ? (
        <div className="trend-tooltip__errors">
          <small>{labels.errors}: {errorGroup.events.map((event) => event.statusCode).join('/')}</small>
          {errorGroup.events.slice(0, 3).map((event) => (
            <small key={`${event.at}-${event.statusCode}`}>
              {event.at} · {event.statusCode} · {formatLatencyValue(event.latencyMs, lang)}
            </small>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function LatencyHealthChart({
  payload,
  lang,
  labels,
}: {
  payload: LatencyHealthPayload;
  lang: LatencyLang;
  labels: LatencyChartLabels;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const buckets = trimTrailingEmptyBuckets(payload.points, payload.errors);
  const domain = latencyYDomain(buckets);
  const maxSlow = Math.max(1, ...buckets.map((point) => point.slowCount));

  const pointX = (index: number) => {
    if (buckets.length <= 1) return MARGIN.left + PLOT_WIDTH / 2;
    return MARGIN.left + (index / (buckets.length - 1)) * PLOT_WIDTH;
  };
  const pointY = (value: number | null) => {
    if (value === null || value <= 0 || domain.ticks.length === 0) return null;
    const ratio = (Math.log10(value) - domain.minLog) / (domain.maxLog - domain.minLog);
    return MARGIN.top + PLOT_HEIGHT - ratio * PLOT_HEIGHT;
  };

  const bucketWidth = buckets.length <= 1 ? PLOT_WIDTH : PLOT_WIDTH / (buckets.length - 1);
  const errorGroupAt = (index: number): LatencyErrorGroup | null =>
    payload.errors.find((group) => group.bucket === buckets[index]?.bucket) ?? null;

  const series: SeriesDef[] = [
    ...PERCENTILE_SERIES.map((item) => ({
      key: item.key,
      color: item.color,
      width: item.width,
      dashed: false,
      legendLabel: labels[item.key],
      values: buckets.map((point) => point[item.key]),
    })),
    ...payload.accounts.map((account, index) => ({
      key: `account-${account.accountId}`,
      color: ACCOUNT_COLORS[index % ACCOUNT_COLORS.length],
      width: 1.4,
      dashed: true,
      legendLabel: (
        <>
          {accountDisplayName(account)} <strong>{labels.p95}</strong>
        </>
      ),
      values: account.points.slice(0, buckets.length).map((point) => point.p95),
    })),
  ];

  return (
    <section className="trend-card">
      <div className="trend-card__topline">
        <div className="section-heading">
          <p className="section-heading__eyebrow">{labels.title}</p>
          <h2>{labels.hint}</h2>
        </div>
        {buckets.length > 0 ? (
          <Legend series={series} labels={labels} hoveredKey={hoveredKey} onHover={setHoveredKey} />
        ) : null}
      </div>

      {buckets.length === 0 ? (
        <div className="empty-state">{labels.noData}</div>
      ) : (
        <div
          className="trend-chart__canvas"
          onMouseLeave={() => { setHoveredKey(null); setHoverIndex(null); }}
        >
          <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={labels.title}>
            <g className="trend-grid">
              {domain.ticks.map((tick) => {
                const y = pointY(tick);
                if (y === null) return null;
                return (
                  <g key={tick}>
                    <line x1={MARGIN.left} y1={y} x2={CHART_WIDTH - MARGIN.right} y2={y} />
                    <text x={MARGIN.left - 10} y={y + 4} textAnchor="end">{formatLatencyTick(tick)}</text>
                  </g>
                );
              })}
              {xTickIndexes(buckets.length).map((index) => (
                <g key={buckets[index].bucket}>
                  <line x1={pointX(index)} y1={MARGIN.top} x2={pointX(index)} y2={CHART_HEIGHT - MARGIN.bottom} />
                  <text x={pointX(index)} y={CHART_HEIGHT - 10} textAnchor="middle">{buckets[index].label}</text>
                </g>
              ))}
            </g>
            {buckets.map((point, index) => {
              if (point.slowCount <= 0) return null;
              const barHeight = Math.max(3, (point.slowCount / maxSlow) * SLOW_BAR_MAX_HEIGHT);
              return (
                <rect
                  key={`slow-${point.bucket}`}
                  x={pointX(index) - bucketWidth / 2 + 1}
                  y={CHART_HEIGHT - MARGIN.bottom - barHeight}
                  width={Math.max(2, bucketWidth - 2)}
                  height={barHeight}
                  fill={SLOW_BAR_COLOR}
                />
              );
            })}
            {buckets.map((point, index) => {
              const group = errorGroupAt(index);
              if (!group) return null;
              return (
                <g key={`err-${point.bucket}`} className="latency-error-marker">
                  <text
                    x={pointX(index)}
                    y={MARGIN.top + 13}
                    textAnchor="middle"
                    fill={ERROR_MARK_COLOR}
                    fontSize="13"
                  >
                    ✕{group.count > 1 ? ` ${group.count}` : ''}
                  </text>
                </g>
              );
            })}
            <line className="trend-axis" x1={MARGIN.left} y1={CHART_HEIGHT - MARGIN.bottom} x2={CHART_WIDTH - MARGIN.right} y2={CHART_HEIGHT - MARGIN.bottom} />
            <line className="trend-axis" x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={CHART_HEIGHT - MARGIN.bottom} />
            <SeriesLayer series={series} hoveredKey={hoveredKey} pointX={pointX} pointY={pointY} />
            <g>
              {buckets.map((point, index) => (
                <rect
                  key={`hit-${point.bucket}`}
                  x={pointX(index) - bucketWidth / 2}
                  y={MARGIN.top}
                  width={bucketWidth}
                  height={PLOT_HEIGHT}
                  fill="transparent"
                  onMouseEnter={() => setHoverIndex(index)}
                  onFocus={() => setHoverIndex(index)}
                  onBlur={() => setHoverIndex(null)}
                />
              ))}
            </g>
          </svg>
          {hoverIndex !== null ? (
            <ChartTooltip
              index={hoverIndex}
              buckets={buckets}
              accounts={payload.accounts}
              errors={payload.errors}
              labels={labels}
              lang={lang}
              x={pointX(hoverIndex)}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}
