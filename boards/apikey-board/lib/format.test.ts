import { describe, expect, it } from 'vitest';

import { formatAbsoluteMinute, formatResetTime } from '@/lib/format';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function inFuture(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

describe('formatResetTime', () => {
  it('renders a dash for missing timestamps', () => {
    expect(formatResetTime(null, 'zh')).toBe('—');
    expect(formatResetTime(null, 'en')).toBe('—');
  });

  it('renders reset for past or immediate timestamps', () => {
    expect(formatResetTime(inFuture(-10 * MINUTE), 'zh')).toBe('已重置');
    expect(formatResetTime(inFuture(-10 * MINUTE), 'en')).toBe('reset');
    expect(formatResetTime(new Date(Date.now() - 1).toISOString(), 'zh')).toBe('已重置');
  });

  it('renders minutes below one hour', () => {
    expect(formatResetTime(inFuture(30 * MINUTE), 'zh')).toBe('30 分钟后');
    expect(formatResetTime(inFuture(30 * MINUTE), 'en')).toBe('in 30m');
  });

  it('renders hours below one day', () => {
    expect(formatResetTime(inFuture(3 * HOUR + 61 * MINUTE), 'zh')).toBe('5 小时后');
  });

  it('renders days plus remainder hours instead of rounding up to whole days', () => {
    // 真实剩余 4 天 1 小时 56 分：旧实现 ceil 成 "5 天后"，新实现精确到小时
    expect(formatResetTime(inFuture(4 * DAY + 116 * MINUTE), 'zh')).toBe('4 天 2 小时后');
    expect(formatResetTime(inFuture(4 * DAY + 116 * MINUTE), 'en')).toBe('in 4d 2h');
    // 真实剩余 5 天 11 小时 17 分
    expect(formatResetTime(inFuture(5 * DAY + 677 * MINUTE), 'zh')).toBe('5 天 12 小时后');
  });

  it('renders plain days when the remainder is zero', () => {
    expect(formatResetTime(inFuture(4 * DAY), 'zh')).toBe('4 天后');
    expect(formatResetTime(inFuture(4 * DAY), 'en')).toBe('in 4d');
  });
});

describe('formatAbsoluteMinute', () => {
  // 看板时区是 Asia/Shanghai（lib/config.ts 默认值），断言必须与其一致
  it('renders the exact minute in the board timezone', () => {
    expect(formatAbsoluteMinute('2026-09-24T12:08:34+08:00')).toBe('2026-09-24 12:08');
    expect(formatAbsoluteMinute('2026-09-24T04:08:00Z')).toBe('2026-09-24 12:08');
  });

  it('does not render midnight as 24:00', () => {
    expect(formatAbsoluteMinute('2026-09-24T00:00:00+08:00')).toBe('2026-09-24 00:00');
  });

  it('renders a dash for missing or invalid values', () => {
    expect(formatAbsoluteMinute(null)).toBe('—');
    expect(formatAbsoluteMinute('')).toBe('—');
    expect(formatAbsoluteMinute('not-a-date')).toBe('—');
  });
});
