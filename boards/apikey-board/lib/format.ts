export function formatInteger(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
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
