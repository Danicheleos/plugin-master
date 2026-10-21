import { describe, expect, it } from 'vitest';
import type { EvalRunResult } from '@pm/protocol';
import { armStats, changedGraders } from './compare';

const run = (score: number, pass: boolean, extra: Partial<EvalRunResult> = {}): EvalRunResult => ({
  score,
  graders: [{ name: 'g', passed: pass }],
  ...extra,
});

describe('armStats', () => {
  it('averages score, cost incl. judge and trace metrics', () => {
    const s = armStats([
      run(1, true, { costUsd: 0.1, judgeCostUsd: 0.02, turns: 3 }),
      run(0, false, { costUsd: 0.3, turns: 5, traceMetrics: { maxContext: 100, modelCalls: 4, toolCallsTotal: 2, numTurns: 7 } as never }),
    ]);
    expect(s.score).toBe(0.5);
    expect(s.cost).toBeCloseTo(0.21);
    expect(s.turns).toBe(5);
    expect(s.maxContext).toBe(100);
    expect(s.graders).toEqual({ g: 0.5 });
  });

  it('leaves metrics undefined without traces', () => {
    expect(armStats([run(1, true)])).toMatchObject({ maxContext: undefined, modelCalls: undefined });
  });
});

describe('changedGraders', () => {
  it('lists graders with a different pass rate', () => {
    const a = armStats([run(1, true)]);
    const b = armStats([run(0, false)]);
    expect(changedGraders(a, b)).toEqual(['g']);
    expect(changedGraders(a, a)).toEqual([]);
  });
});
