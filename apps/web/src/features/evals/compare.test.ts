import { describe, expect, it } from 'vitest';
import type { EvalCase } from '@pm/protocol';
import {
  ablationAsBaseline,
  baselineKey,
  changedGraders,
  compareToBaseline,
  latestPerCase,
  parseBaseline,
  repeatedCaseNames,
  type Baseline,
} from './compare';

const run = (score: number) => ({ score, passed: score >= 1, graders: [] });
const mkCase = (
  name: string,
  withScore: number[],
  withoutScore: number[] = [],
) =>
  ({
    name,
    graders: [],
    aggregates: { score: withScore[0] },
    arms: { with: withScore.map(run), without: withoutScore.map(run) },
  }) as unknown as EvalCase;

describe('changedGraders', () => {
  it('lists graders with a different pass rate', () => {
    const a = { graders: { g: 1, h: 1 } };
    const b = { graders: { g: 0, h: 1 } };
    expect(changedGraders(a, b)).toEqual(['g']);
    expect(changedGraders(a, a)).toEqual([]);
  });
  it('a grader missing on one side counts as changed', () => {
    expect(changedGraders({ graders: { g: 1 } }, {})).toEqual(['g']);
  });
});

describe('repeatedCaseNames / latestPerCase', () => {
  const cases = [
    { name: 'a', i: 1 },
    { name: 'b', i: 2 },
    { name: 'a', i: 3 },
    { name: 'a', i: 4 },
  ];
  it('finds names that occur more than once', () => {
    expect([...repeatedCaseNames(cases)]).toEqual(['a']);
    expect(repeatedCaseNames([]).size).toBe(0);
  });
  it('keeps the last occurrence per name in order of first appearance', () => {
    expect(latestPerCase(cases).map((c) => c.i)).toEqual([4, 2]);
  });
});

describe('baseline encoding', () => {
  it('round-trips every kind', () => {
    const all: Baseline[] = [
      { kind: 'ablation' },
      { kind: 'run', runId: 'plugin-eval/x' },
      { kind: 'group', groupId: 'g1' },
    ];
    for (const b of all) expect(parseBaseline(baselineKey(b))).toEqual(b);
  });
  it('keeps a run and a group of the same id apart', () => {
    expect(baselineKey({ kind: 'run', runId: 'x' })).not.toBe(
      baselineKey({ kind: 'group', groupId: 'x' }),
    );
  });
});

describe('ablationAsBaseline / compareToBaseline', () => {
  it('turns the without arm into the plugin arm', () => {
    const b = ablationAsBaseline(mkCase('c', [1], [0.5]));
    expect(b.arms.with.map((r) => r.score)).toEqual([0.5]);
    expect(b.arms.without).toEqual([]);
    expect(b.aggregates).toEqual({});
  });
  it('compares a case with its own without arm', () => {
    const rows = compareToBaseline([mkCase('c', [1], [0.5])], 'ablation');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'c',
      from: { score: 0.5 },
      to: { score: 1 },
    });
    expect(rows[0]?.delta).toBeCloseTo(0.5);
  });
  it('compares with the case of the same name; unmatched cases have no row', () => {
    const rows = compareToBaseline(
      [mkCase('a', [1]), mkCase('b', [1])],
      [mkCase('a', [0.25])],
    );
    expect(rows.map((r) => r.name)).toEqual(['a']);
    expect(rows[0]?.delta).toBeCloseTo(0.75);
    expect(compareToBaseline([mkCase('a', [1])], [])).toEqual([]);
  });
});
