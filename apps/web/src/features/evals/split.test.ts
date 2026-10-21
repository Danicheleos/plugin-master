import { describe, expect, it } from 'vitest';
import type { EvalCase } from '@pm/protocol';
import { splitRepetitions } from './compare';

const r = (score: number, passed: boolean) => ({ score, passed, graders: [] });
const c = (
  name: string,
  w: ReturnType<typeof r>[],
  wo: ReturnType<typeof r>[] = [],
) =>
  ({
    name,
    graders: [],
    arms: { with: w, without: wo },
    aggregates: { score: 0.5 },
  }) as unknown as EvalCase;

describe('splitRepetitions', () => {
  it('gives each repetition of the with arm its own row with its own score and delta', () => {
    const rows = splitRepetitions([
      c('a', [r(1, true), r(0.5, false)], [r(0.25, false)]),
      c('b', [r(0.7, true)]),
    ]);
    expect(rows.map((x) => [x.name, x.rep, x.of])).toEqual([
      ['a', 1, 2],
      ['a', 2, 2],
      ['b', undefined, undefined],
    ]);
    expect(rows[0]?.aggregates).toMatchObject({
      score: 1,
      passRate: 1,
      delta: 0.75,
    });
    expect(rows[1]?.arms.without).toEqual([]);
    expect(rows[1]?.aggregates.delta).toBeUndefined();
  });
});
