import { appConfig } from '@/lib/config';

export function formatInteger(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

const minuteFormatters = new Map<string, Intl.DateTimeFormat>();

function minuteFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = minuteFormatters.get(timeZone);
  if (cached) return cached;
  // hourCycle h23：避免 zh-CN 下午夜被格式化成 24:00
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  minuteFormatters.set(timeZone, formatter);
  return formatter;
}

/**
 * 精确到分钟的绝对时刻（按看板时区渲染，如 2026-09-24 12:08）。
 * 用于额度重置这类"必须知道确切几点"的场景——相对倒计时（"3 天 2 小时后"）看不出具体时刻。
 */
export function formatAbsoluteMinute(dateString: string | null): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (!Number.isFinite(date.getTime())) return '—';
  const parts = minuteFormatter(appConfig.timezone).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

// formatResetTime 渲染额度窗口重置倒计时。天级以下按分钟/小时向上取整；
// 天级显示"天 + 余小时"，不再 ceil 成整天——否则 4.08 天会显示成"5 天后"，
// 与上游真实重置时刻（绝对 reset-at）最多偏差近一天。
export function formatResetTime(dateString: string | null, lang: 'zh' | 'en') {
  if (!dateString) return '—';
  const diffMs = new Date(dateString).getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return '—';
  if (diffMs <= 0) return lang === 'zh' ? '已重置' : 'reset';
  const diffMinutes = Math.ceil(diffMs / 60000);
  if (diffMinutes < 60) return lang === 'zh' ? `${diffMinutes} 分钟后` : `in ${diffMinutes}m`;
  const diffHours = Math.ceil(diffMinutes / 60);
  if (diffHours < 24) return lang === 'zh' ? `${diffHours} 小时后` : `in ${diffHours}h`;
  const days = Math.floor(diffHours / 24);
  const remainderHours = diffHours % 24;
  if (remainderHours === 0) {
    return lang === 'zh' ? `${days} 天后` : `in ${days}d`;
  }
  return lang === 'zh' ? `${days} 天 ${remainderHours} 小时后` : `in ${days}d ${remainderHours}h`;
}
