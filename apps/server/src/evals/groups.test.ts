import type { EvalResult, EvalRunSummary } from '@pm/protocol';
import { describe, expect, it } from 'vitest';
import { GAP_MS, groupRuns, mergeGroup, type RunInput } from './groups';

const T0 = Date.parse('2026-10-12T23:00:00.000Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

function run(
  id: string,
  startMin: number,
  durMin: number,
  name = id,
  extra: Partial<EvalRunSummary> = {},
  score = 1,
): RunInput {
  return {
    summary: {
      id,
      startedAt: at(startMin),
      durationSeconds: durMin * 60,
      costUsd: 0.5,
      threshold: 1,
      ablation: 'none',
      modelOverride: 'm',
      claudeVersion: 'c1',
      pluginVersion: 'p1',
      ...extra,
    },
    cases: [{ name, score, runs: 3 }],
  };
}

describe('groupRuns', () => {
  it('groups a sequential batch and sums its aggregates', () => {
    const [g, ...rest] = groupRuns([run('c', 4, 2), run('a', 0, 2), run('b', 2, 2, 'b', {}, 0.5)]);
    expect(rest).toEqual([]);
    expect(g).toMatchObject({
      id: 'a',
      runIds: ['a', 'b', 'c'],
      startedAt: at(0),
      endedAt: at(6),
      durationSeconds: 360,
      totalRuns: 9,
      casesTotal: 3,
      casesPassed: 2,
      costUsd: 1.5,
    });
    expect(g?.score).toBeCloseTo(2.5 / 3);
  });

  it('splits on a gap longer than 10 minutes, not on exactly 10', () => {
    expect(groupRuns([run('a', 0, 1), run('b', 12, 1)]).map((g) => g.runIds)).toEqual([['b'], ['a']]);
    expect(groupRuns([run('a', 0, 1), run('b', 11.01, 1)])).toHaveLength(2);
    expect(groupRuns([run('a', 0, 1), run('b', 11, 1)])).toHaveLength(1);
    expect(GAP_MS).toBe(600_000);
  });

  it('splits on model, ablation, claude or plugin version', () => {
    for (const diff of [
      { modelOverride: 'other' },
      { ablation: 'with-without' },
      { claudeVersion: 'c2' },
      { pluginVersion: 'p2' },
    ])
      expect(groupRuns([run('a', 0, 1), run('b', 1, 1, 'b', diff)])).toHaveLength(2);
  });

  it('keeps concurrent overlapping runs in one group', () => {
    const [g, ...rest] = groupRuns([run('long', 0, 60), run('x', 5, 1), run('y', 40, 1), run('z', 65, 1)]);
    expect(rest).toEqual([]);
    expect(g?.runIds).toEqual(['long', 'x', 'y', 'z']);
    expect(g?.durationSeconds).toBe(66 * 60);
  });

  it('makes a single full-suite run a group of one and puts broken runs last', () => {
    const full: RunInput = {
      summary: run('full', 0, 3).summary,
      cases: [
        { name: 'a', score: 1, runs: 2 },
        { name: 'b', score: 0, runs: 2 },
      ],
    };
    const groups = groupRuns([{ summary: { id: 'bad', error: 'x' }, cases: [] }, full]);
    expect(groups.map((g) => g.id)).toEqual(['full', 'bad']);
    expect(groups[0]).toMatchObject({ totalRuns: 4, casesTotal: 2, casesPassed: 1, score: 0.5, durationSeconds: 180 });
    expect(groups[1]).toMatchObject({ error: 'x', runIds: ['bad'] });
  });

  it('uses the latest result of a case that appears in several runs', () => {
    const [g] = groupRuns([run('a', 0, 1, 'k', {}, 0), run('b', 2, 1, 'k', {}, 1)]);
    expect(g).toMatchObject({ casesTotal: 1, casesPassed: 1, score: 1, totalRuns: 6 });
  });

  it('keeps every invocation of a repeated case in the merged result', () => {
    const runs = ['a', 'b', 'c'].map((id, i) => run(id, i * 2, 1, 'k', {}, i === 2 ? 1 : 0));
    const [g] = groupRuns(runs);
    const result = (id: string) => ({ suite: {}, cases: [{ name: 'k', arms: { with: [] }, aggregates: { score: id === 'c' ? 1 : 0 } }] }) as unknown as EvalResult;
    const results = new Map(['a', 'b', 'c'].map((id) => [id, result(id)]));
    expect(mergeGroup(g as NonNullable<typeof g>, results).cases).toHaveLength(1);
    const merged = mergeGroup(g as NonNullable<typeof g>, results, true);
    expect(merged.cases.map((c) => (c as { runId?: string }).runId)).toEqual(['a', 'b', 'c']);
    expect(merged.aggregates).toMatchObject({ casesTotal: 1, casesPassed: 1, overallScore: 1 });
  });
});
