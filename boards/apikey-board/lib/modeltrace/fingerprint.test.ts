import { describe, expect, it } from 'vitest';

import { analyzeOutputs, parseNumbers } from '@/lib/modeltrace/fingerprint';
import type { ChallengeAnswer, ModelTraceBank } from '@/lib/modeltrace/types';
import bankJson from '@/lib/modeltrace/data/unified_bank.json';
import fixture from '@/lib/modeltrace/testdata/attribution.json';

const bank = bankJson as unknown as ModelTraceBank;

type PythonResult = {
  prediction: string;
  probability: number;
  results: { model: string; probability: number }[];
};

type Fixture = {
  inputs: ChallengeAnswer[];
  combined: PythonResult;
  single: PythonResult;
  two: PythonResult;
  parse_cases: { text: string }[];
  parse_results: number[][];
};

const data = fixture as unknown as Fixture;

function expectAttributionClose(actual: PythonResult, inputs: ChallengeAnswer[]) {
  const result = analyzeOutputs(inputs, bank);
  expect(result.prediction).toBe(actual.prediction);
  expect(result.probability).toBeCloseTo(actual.probability, 9);
  expect(result.results.map((r) => r.model)).toEqual(
    actual.results.map((r) => r.model),
  );
  for (const expected of actual.results) {
    const got = result.results.find((r) => r.model === expected.model);
    expect(got).toBeDefined();
    expect(got!.probability).toBeCloseTo(expected.probability, 9);
  }
}

describe('parseNumbers', () => {
  it('matches the Python reference on separator/range edge cases', () => {
    data.parse_cases.forEach((testCase, index) => {
      expect(parseNumbers(testCase.text)).toEqual(data.parse_results[index]);
    });
  });
});

describe('analyzeOutputs (parity with Python original, tolerance 1e-9)', () => {
  it('matches on three combined answers', () => {
    expectAttributionClose(data.combined, data.inputs);
  });

  it('matches on a single answer (calibration key "1")', () => {
    expectAttributionClose(data.single, data.inputs.slice(0, 1));
  });

  it('matches on two answers (calibration key "2")', () => {
    expectAttributionClose(data.two, data.inputs.slice(0, 2));
  });
});
