import type { LatencyErrorGroup, LatencyHealthPoint } from '@/lib/types';

export type LatencyLang = 'zh' | 'en';

export function formatLatencyTick(value: number): string {
  if (value < 1000) return `${value}ms`;
  if (value < 120000) {
    const seconds = value / 1000;
    return `${seconds % 1 === 0 ? seconds : seconds.toFixed(1)}s`;
  }
  const minutes = value / 60000;
  return `${minutes % 1 === 0 ? minutes : minutes.toFixed(1)}m`;
}

export function formatLatencyValue(value: number | null, lang: LatencyLang): string {
  if (value === null || Number.isNaN(value)) return '—';
  if (value < 1000) return lang === 'zh' ? `${Math.round(value)} 毫秒` : `${Math.round(value)} ms`;
  if (value < 60000) {
    const seconds = value / 1000;
    return lang === 'zh' ? `${seconds.toFixed(seconds >= 10 ? 0 : 1)} 秒` : `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
  }
  const minutes = value / 60000;
  return lang === 'zh' ? `${minutes.toFixed(minutes >= 10 ? 0 : 1)} 分钟` : `${minutes.toFixed(minutes >= 10 ? 0 : 1)} min`;
}

// 去掉尾部没有任何请求、慢请求或上游错误的空桶（例如"今日"里还没到的小时），
// 避免半张图都是空白。
export function trimTrailingEmptyBuckets(
  points: LatencyHealthPoint[],
  errors: LatencyErrorGroup[],
): LatencyHealthPoint[] {
  const errorBuckets = new Set(errors.map((group) => group.bucket));
  let lastActiveIndex = points.length - 1;
  while (
    lastActiveIndex > 0
    && points[lastActiveIndex].requests === 0
    && points[lastActiveIndex].slowCount === 0
    && !errorBuckets.has(points[lastActiveIndex].bucket)
  ) {
    lastActiveIndex -= 1;
  }
  return points.slice(0, lastActiveIndex + 1);
}

// Y 轴按数据实际范围取对数域：从最小值所在数量级，到最大值上方的 1/2/5 刻度。
export function latencyTickValues(minMs: number, maxMs: number): number[] {
  const low = 10 ** Math.floor(Math.log10(minMs));
  const ticks: number[] = [];
  for (let exp = Math.floor(Math.log10(low)); exp < 12; exp += 1) {
    const decade = 10 ** exp;
    for (const multiplier of [1, 2, 5]) {
      const value = multiplier * decade;
      if (value < low) continue;
      ticks.push(value);
      if (value >= maxMs) return ticks;
    }
  }
  return ticks;
}

export type LatencyYDomain = {
  ticks: number[];
  minLog: number;
  maxLog: number;
};

export function latencyYDomain(points: LatencyHealthPoint[]): LatencyYDomain {
  const values = points
    .flatMap((point) => [point.p50, point.p95, point.p99])
    .filter((value): value is number => value !== null && value > 0);
  if (values.length === 0) return { ticks: [], minLog: 0, maxLog: 1 };
  const ticks = latencyTickValues(Math.min(...values), Math.max(...values));
  const minLog = Math.log10(ticks[0]);
  const maxLog = Math.max(Math.log10(ticks[ticks.length - 1]), minLog + 1);
  return { ticks, minLog, maxLog };
}

export function xTickIndexes(count: number): number[] {
  if (count === 0) return [];
  const step = count <= 8 ? 1 : Math.ceil(count / 6);
  return Array.from({ length: count }, (_, index) => index)
    .filter((index) => index === 0 || index === count - 1 || index % step === 0);
}

export type SplitSeries = {
  // 连续非空段（含首尾下标，闭区间），用于画线；单点段画线不可见，单独返回画圆点。
  segments: [number, number][];
  dots: number[];
};

export function splitSeries(values: (number | null)[]): SplitSeries {
  const segments: [number, number][] = [];
  const dots: number[] = [];
  let start: number | null = null;

  const flush = (end: number) => {
    if (start === null) return;
    if (start === end) dots.push(start);
    else segments.push([start, end]);
    start = null;
  };

  values.forEach((value, index) => {
    if (value === null || value <= 0) {
      flush(index - 1);
      return;
    }
    if (start === null) start = index;
  });
  flush(values.length - 1);

  return { segments, dots };
}
