import { describe, expect, it } from 'vitest';
import type { EvalResult } from '@pm/protocol';
import { compare, comparisonText } from './summary';

const run = (score: number, passed = score === 1) => ({ score, passed, graders: [] });
const result = (cases: Record<string, number[]>) =>
  ({
    cases: Object.entries(cases).map(([name, scores]) => ({
      name,
      aggregates: {},
      arms: { with: scores.map((s) => run(s)) },
    })),
  }) as unknown as EvalResult;

describe('compare', () => {
  it('adds n, sd, delta, flaky and a suite verdict', () => {
    const base = { runId: 'b', result: result({ a: [0], b: [0, 1] }) };
    const c = compare(result({ a: [1, 1, 1], b: [1] }), base);
    expect(c.cases[0]).toMatchObject({ case: 'a', score: 1, baselineScore: 0, n: 3, baselineN: 1, delta: 1, flaky: false });
    expect(c.cases[1]).toMatchObject({ case: 'b', delta: 0.5, flaky: true, baselineSd: expect.any(Number) });
    expect(c.suite?.cases).toBe(2);
  });
  it('a single-run win on few cases is inconclusive, not an improvement', () => {
    const c = compare(result({ a: [1], b: [1] }), { runId: 'b', result: result({ a: [0], b: [0.5] }) });
    expect(c.suite?.verdict).toBe('inconclusive');
    expect(comparisonText(c)).toContain('inconclusive');
  });
  it('a consistent win on many cases is improved', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    const head = Object.fromEntries(names.map((n) => [n, [1, 1, 1]]));
    const base = Object.fromEntries(names.map((n) => [n, [0.5, 0.25, 0.5]]));
    expect(compare(result(head), { runId: 'b', result: result(base) }).suite?.verdict).toBe('improved');
  });
  it('no baseline: no deltas, inconclusive', () => {
    const c = compare(result({ a: [1] }));
    expect(c.baseline).toBeNull();
    expect(c.suite).toMatchObject({ cases: 0, verdict: 'inconclusive' });
  });
});
