import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  ADOPTION_WINDOW_DAYS,
  EFFECTIVE_ACTIVE_DAYS_THRESHOLD,
  EFFECTIVE_REQUESTS_THRESHOLD,
  buildClientBreakdown,
  buildCustomRosterRows,
  buildModelBreakdown,
  buildSummary,
  buildTrend,
  classifyAdoptionStage,
  classifyAiCodingClient,
  clientLabel,
  getAdoption,
  parseAdoptionLang,
  sortPersonRows,
  stageLabel,
  type AdoptionLang,
} from '@/lib/adoption';
import type { AdoptionPersonRow } from '@/lib/types';

describe('adoption stage classification', () => {
  it('marks zero requests as not adopted', () => {
    expect(classifyAdoptionStage(0, 0)).toBe('not_adopted');
  });

  it('marks a single request as light adoption', () => {
    expect(classifyAdoptionStage(1, 1)).toBe('light_adoption');
  });

  it('stays light below the effective thresholds', () => {
    expect(classifyAdoptionStage(EFFECTIVE_REQUESTS_THRESHOLD - 1, 0)).toBe('light_adoption');
    expect(classifyAdoptionStage(99, EFFECTIVE_ACTIVE_DAYS_THRESHOLD - 1)).toBe('light_adoption');
  });

  it('becomes effective with enough requests', () => {
    expect(classifyAdoptionStage(EFFECTIVE_REQUESTS_THRESHOLD, 1)).toBe('effective_use');
  });

  it('becomes effective with enough active days even with few requests', () => {
    expect(classifyAdoptionStage(2, EFFECTIVE_ACTIVE_DAYS_THRESHOLD)).toBe('effective_use');
  });
});

describe('ai coding client classification', () => {
  it('detects codex desktop before codex tui', () => {
    expect(
      classifyAiCodingClient('Codex Desktop/0.137.0-alpha.4 (Windows 10.0.19045; x86_64)'),
    ).toBe('codex_desktop');
  });

  it('detects codex tui for codex-tui user agents', () => {
    expect(
      classifyAiCodingClient('codex-tui/0.142.0 (Arch Linux Rolling Release; x86_64)'),
    ).toBe('codex_tui');
  });

  it('detects claude code regardless of separator', () => {
    expect(classifyAiCodingClient('claude-code/1.0.0')).toBe('claude_code');
    expect(classifyAiCodingClient('Claude Code 1.0.0')).toBe('claude_code');
  });

  it('falls back to other for endpoint-only matches', () => {
    expect(classifyAiCodingClient(null)).toBe('other');
    expect(classifyAiCodingClient('')).toBe('other');
    expect(classifyAiCodingClient('curl/8.0')).toBe('other');
  });
});

describe('label helpers', () => {
  const langs: AdoptionLang[] = ['zh', 'en'];
  for (const lang of langs) {
    it(`returns labels for every client in ${lang}`, () => {
      expect(clientLabel('codex_tui', lang)).toMatch(/Codex TUI/);
      expect(clientLabel('codex_desktop', lang)).toMatch(/Codex Desktop/);
      expect(clientLabel('claude_code', lang)).toMatch(/Claude Code/);
      expect(clientLabel('other', lang)).toBeTruthy();
    });
  }

  it('parses adoption lang conservatively', () => {
    expect(parseAdoptionLang('zh-CN')).toBe('zh');
    expect(parseAdoptionLang('zh')).toBe('zh');
    expect(parseAdoptionLang('en')).toBe('en');
    expect(parseAdoptionLang(null)).toBe('en');
  });

  it('renders stage labels in both languages', () => {
    expect(stageLabel('not_adopted', 'zh')).toBe('未采用');
    expect(stageLabel('light_adoption', 'zh')).toBe('轻度采用');
    expect(stageLabel('effective_use', 'zh')).toBe('有效使用');
    expect(stageLabel('effective_use', 'en')).toBe('Effective Use');
  });
});

describe('person row sorting', () => {
  const make = (overrides: Partial<AdoptionPersonRow>): AdoptionPersonRow => ({
    apiKeyId: 0,
    personName: '',
    stage: 'not_adopted',
    codingRequests: 0,
    codingActiveDays: 0,
    codingTokens: 0,
    codingCost: 0,
    lastCodingAt: null,
    primaryClient: 'other',
    primaryClientLabel: '-',
    primaryModel: null,
    ...overrides,
  });

  it('orders by governance priority then by request volume', () => {
    const rows = [
      make({ apiKeyId: 1, personName: '张三', stage: 'effective_use', codingRequests: 500 }),
      make({ apiKeyId: 2, personName: '李四', stage: 'not_adopted', codingRequests: 0 }),
      make({ apiKeyId: 3, personName: '王五', stage: 'light_adoption', codingRequests: 5 }),
      make({ apiKeyId: 4, personName: '赵六', stage: 'not_adopted', codingRequests: 0 }),
      make({ apiKeyId: 5, personName: '钱七', stage: 'effective_use', codingRequests: 900 }),
    ];

    const sorted = sortPersonRows(rows);
    expect(sorted.map((row) => row.apiKeyId)).toEqual([2, 4, 3, 5, 1]);
  });

  it('sorts not-adopted people by name ascending', () => {
    const rows = [
      make({ apiKeyId: 1, personName: 'B', stage: 'not_adopted' }),
      make({ apiKeyId: 2, personName: 'A', stage: 'not_adopted' }),
    ];
    expect(sortPersonRows(rows).map((row) => row.personName)).toEqual(['A', 'B']);
  });

  it('ties break light/effective by name', () => {
    const rows = [
      make({ apiKeyId: 1, personName: 'B', stage: 'light_adoption', codingRequests: 3 }),
      make({ apiKeyId: 2, personName: 'A', stage: 'light_adoption', codingRequests: 3 }),
    ];
    expect(sortPersonRows(rows).map((row) => row.personName)).toEqual(['A', 'B']);
  });
});

describe('custom roster people', () => {
  const keyedPerson: AdoptionPersonRow = {
    apiKeyId: 9,
    personName: '已有 Key',
    stage: 'effective_use',
    codingRequests: 200,
    codingActiveDays: 5,
    codingTokens: 1000,
    codingCost: 2,
    lastCodingAt: '2026-07-10T00:00:00.000Z',
    primaryClient: 'codex_tui',
    primaryClientLabel: 'Codex TUI',
    primaryModel: 'gpt-5.5',
  };

  it('adds roster names without active keys as not adopted people', () => {
    const rows = buildCustomRosterRows(['已有 Key', '无 Key 甲', '无 Key 乙'], [keyedPerson]);

    expect(rows.map((row) => row.personName)).toEqual(['无 Key 甲', '无 Key 乙']);
    expect(rows.map((row) => row.apiKeyId)).toEqual([-1, -2]);
    expect(rows.every((row) => row.stage === 'not_adopted')).toBe(true);
  });

  it('does not add custom people when the roster is inactive', () => {
    expect(buildCustomRosterRows(null, [keyedPerson])).toEqual([]);
  });
});

describe('adoption query parameters', () => {
  it('uses every positional parameter without untyped gaps', async () => {
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('SELECT id\n     FROM api_keys')) {
        return Promise.resolve({ rows: [{ id: 9 }] });
      }
      if (sql.includes('SELECT name FROM groups')) {
        return Promise.resolve({ rows: [{ name: '公司专用' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const pool = { query } as unknown as Pool;

    await getAdoption(pool, 9, 'zh', ['安耐吉-范驰']);

    for (const [sql, params] of query.mock.calls as Array<[string, unknown[]]>) {
      const indexes = Array.from(sql.matchAll(/\$(\d+)/g), (match) => Number(match[1]));
      const maxIndex = Math.max(0, ...indexes);
      expect(maxIndex).toBe(params.length);
      expect(new Set(indexes)).toEqual(new Set(Array.from({ length: maxIndex }, (_, index) => index + 1)));
    }
  });
});

describe('summary computation', () => {
  const make = (stage: AdoptionPersonRow['stage'], requests: number): AdoptionPersonRow => ({
    apiKeyId: 0,
    personName: '',
    stage,
    codingRequests: requests,
    codingActiveDays: 0,
    codingTokens: requests * 100,
    codingCost: requests,
    lastCodingAt: null,
    primaryClient: 'other',
    primaryClientLabel: '-',
    primaryModel: null,
  });

  it('computes rates and totals', () => {
    const rows = [
      make('effective_use', 500),
      make('light_adoption', 5),
      make('not_adopted', 0),
      make('not_adopted', 0),
    ];
    const summary = buildSummary(rows);
    expect(summary.totalPeople).toBe(4);
    expect(summary.adoptedPeople).toBe(2);
    expect(summary.effectivePeople).toBe(1);
    expect(summary.notAdoptedPeople).toBe(2);
    expect(summary.lightAdoptionPeople).toBe(1);
    expect(summary.adoptionRate).toBeCloseTo(0.5, 5);
    expect(summary.effectiveRate).toBeCloseTo(0.25, 5);
    expect(summary.codingRequests).toBe(505);
    expect(summary.codingTokens).toBe(50500);
    expect(summary.codingCost).toBe(505);
  });

  it('handles empty populations', () => {
    const summary = buildSummary([]);
    expect(summary.adoptionRate).toBe(0);
    expect(summary.effectiveRate).toBe(0);
    expect(summary.totalPeople).toBe(0);
  });
});

describe('client breakdown', () => {
  it('aggregates requests and people per client', () => {
    const rows = [
      { apiKeyId: 1, userAgent: 'codex-tui/0.1', requests: 10 },
      { apiKeyId: 1, userAgent: 'Codex Desktop/0.1', requests: 4 },
      { apiKeyId: 2, userAgent: 'codex-tui/0.1', requests: 20 },
      { apiKeyId: 3, userAgent: 'curl/8', requests: 2 },
    ];
    const breakdown = buildClientBreakdown(rows, 'zh');
    const tui = breakdown.find((row) => row.client === 'codex_tui')!;
    expect(tui.requests).toBe(30);
    expect(tui.people).toBe(2);
    const desktop = breakdown.find((row) => row.client === 'codex_desktop')!;
    expect(desktop.requests).toBe(4);
    expect(desktop.people).toBe(1);
    const other = breakdown.find((row) => row.client === 'other')!;
    expect(other.requests).toBe(2);
    expect(other.people).toBe(1);
  });

  it('is sorted by request volume descending', () => {
    const rows = [
      { apiKeyId: 1, userAgent: 'Codex Desktop/0.1', requests: 5 },
      { apiKeyId: 2, userAgent: 'codex-tui/0.1', requests: 50 },
    ];
    const breakdown = buildClientBreakdown(rows, 'en');
    expect(breakdown[0].client).toBe('codex_tui');
    expect(breakdown[1].client).toBe('codex_desktop');
  });
});

describe('model breakdown', () => {
  it('limits to top 5 by requests', () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      apiKeyId: index,
      model: `model-${index}`,
      requests: (index + 1) * 10,
      tokens: (index + 1) * 100,
    }));
    const breakdown = buildModelBreakdown(rows, 5);
    expect(breakdown).toHaveLength(5);
    expect(breakdown[0].requests).toBe(70);
    expect(breakdown[4].requests).toBe(30);
  });

  it('counts distinct people per model', () => {
    const rows = [
      { apiKeyId: 1, model: 'gpt-5.5', requests: 3, tokens: 30 },
      { apiKeyId: 1, model: 'gpt-5.5', requests: 4, tokens: 40 },
      { apiKeyId: 2, model: 'gpt-5.5', requests: 1, tokens: 10 },
    ];
    const breakdown = buildModelBreakdown(rows, 5);
    expect(breakdown[0].model).toBe('gpt-5.5');
    expect(breakdown[0].requests).toBe(8);
    expect(breakdown[0].people).toBe(2);
    expect(breakdown[0].tokens).toBe(80);
  });
});

describe('trend computation', () => {
  it('accumulates adoption and effective counts over the window', () => {
    const dailyRows = [
      { day: '2026-06-01', apiKeyId: 1, requests: 1 },
      { day: '2026-06-01', apiKeyId: 2, requests: 100 },
      { day: '2026-06-02', apiKeyId: 1, requests: 1 },
      { day: '2026-06-02', apiKeyId: 3, requests: 1 },
      { day: '2026-06-05', apiKeyId: 1, requests: 1 },
    ];
    const trend = buildTrend(dailyRows);
    expect(trend.map((point) => point.day)).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-05',
    ]);

    const first = trend[0];
    expect(first.adoptedPeople).toBe(2);
    expect(first.effectivePeople).toBe(1);

    const second = trend[1];
    expect(second.adoptedPeople).toBe(3);
    expect(second.effectivePeople).toBe(1);

    const third = trend[2];
    expect(third.adoptedPeople).toBe(3);
    expect(third.effectivePeople).toBe(1);
  });

  it('treats endpoint-only matches (null api key) as no progress', () => {
    const trend = buildTrend([
      { day: '2026-06-01', apiKeyId: null, requests: 0 },
    ]);
    expect(trend[0].adoptedPeople).toBe(0);
  });

  it('exposes the configured window length', () => {
    expect(ADOPTION_WINDOW_DAYS).toBe(30);
  });
});
