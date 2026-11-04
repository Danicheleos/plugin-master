import { describe, expect, it } from 'vitest';
import type { EvalCase } from './evals';
import { caseSide, caseStats, compareCases, sd } from './stats';

describe('caseStats', () => {
  it('gives n, mean and sd', () => {
    const s = caseStats([{ score: 1 }, { score: 0.5 }, { score: 0 }]);
    expect(s).toMatchObject({ n: 3, mean: 0.5, sd: 0.5, flaky: true });
  });
  it('one run has no sd and is not flaky; passed stands in for a missing score', () => {
    expect(caseStats([{ score: 0.8 }])).toEqual({ n: 1, mean: 0.8, flaky: false });
    expect(caseStats([{ passed: true }, { passed: true }])).toMatchObject({ n: 2, mean: 1, sd: 0, flaky: false });
  });
  it('flaky when runs both pass and fail, even with close scores', () => {
    expect(caseStats([{ score: 0.5, passed: true }, { score: 0.45, passed: false }]).flaky).toBe(true);
  });
  it('no runs', () => {
    expect(caseStats([])).toEqual({ n: 0, flaky: false });
  });
  it('sd needs two values', () => {
    expect(sd([1])).toBeUndefined();
  });
});

describe('compareCases', () => {
  it('joins by name with deltas', () => {
    const rows = compareCases(
      [{ name: 'a', score: 0.5 }, { name: 'b', score: 1 }],
      [{ name: 'b', score: 0.75 }, { name: 'c' }],
    );
    expect(rows.map((r) => [r.name, r.delta])).toEqual([['a', undefined], ['b', -0.25], ['c', undefined]]);
    expect(rows[0]).not.toHaveProperty('to');
    expect(rows[1].from).toEqual({ score: 1 });
  });
});


const run = (score: number, passed: boolean, extra: Record<string, unknown> = {}) => ({ score, passed, graders: [{ name: 'g', passed }], ...extra });

describe('caseSide', () => {
  it('averages score, cost incl. judge, trace metrics and grader pass rates', () => {
    const c = {
      name: 'a',
      runId: 'r1',
      aggregates: {},
      arms: {
        with: [
          run(1, true, { costUsd: 0.1, judgeCostUsd: 0.02, turns: 3 }),
          run(0, false, { costUsd: 0.3, turns: 5, traceMetrics: { maxContext: 100, modelCalls: 4, toolCallsTotal: 2, numTurns: 7 } }),
        ],
        without: [],
      },
    } as unknown as EvalCase;
    const s = caseSide(c);
    expect(s).toMatchObject({ runId: 'r1', arm: 'with', n: 2, score: 0.5, turns: 5, maxContext: 100, modelCalls: 4, toolCalls: 2, runs: 2, passed: false, graders: { g: 0.5 } });
    expect(s.costUsd).toBeCloseTo(0.21);
  });
  it('prefers the harness score and leaves trace metrics out without traces', () => {
    const c = { name: 'a', aggregates: { score: 0.9 }, arms: { with: [run(1, true)], without: [] } } as unknown as EvalCase;
    expect(caseSide(c)).toMatchObject({ score: 0.9, modelCalls: undefined });
  });
});
