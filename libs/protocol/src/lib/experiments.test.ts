import { describe, expect, it } from 'vitest';
import { ExperimentComparisonSchema } from './experiments.js';

describe('ExperimentComparisonSchema', () => {
  it('reads a stored row from before the shared case summary', () => {
    const old = {
      baseline: { runId: 'b' },
      cases: [
        {
          case: 'a',
          score: 1,
          baselineScore: 0.5,
          n: 3,
          sd: 0.1,
          baselineN: 2,
          baselineSd: 0.2,
          delta: 0.5,
          flaky: true,
        },
      ],
    };
    expect(ExperimentComparisonSchema.parse(old).cases[0]).toEqual({
      name: 'a',
      from: { score: 0.5, runs: 2, sd: 0.2 },
      to: { score: 1, runs: 3, sd: 0.1, flaky: true },
      delta: 0.5,
    });
  });
  it('keeps a row in the new shape', () => {
    const row = { name: 'a', to: { score: 1 }, delta: 0 };
    expect(
      ExperimentComparisonSchema.parse({ baseline: null, cases: [row] })
        .cases[0],
    ).toEqual(row);
  });
});
