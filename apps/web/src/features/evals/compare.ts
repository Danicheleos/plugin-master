import type { EvalCase, EvalRunResult } from '@pm/protocol';

export type ArmStats = {
  runs: number;
  score?: number;
  /** Including the judge. */
  cost?: number;
  turns?: number;
  maxContext?: number;
  modelCalls?: number;
  toolCalls?: number;
  /** Pass rate of each grader over the runs. */
  graders: Record<string, number>;
};

const mean = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
};

/** Means over the runs of one arm; trace metrics only count runs that have a trace. */
export function armStats(runs: EvalRunResult[]): ArmStats {
  const names = new Set(runs.flatMap((r) => r.graders.map((g) => g.name)));
  return {
    runs: runs.length,
    score: mean(runs.map((r) => r.score)),
    cost: mean(
      runs.map((r) =>
        r.costUsd === undefined ? undefined : r.costUsd + (r.judgeCostUsd ?? 0),
      ),
    ),
    turns: mean(runs.map((r) => r.traceMetrics?.numTurns ?? r.turns)),
    maxContext: mean(runs.map((r) => r.traceMetrics?.maxContext)),
    modelCalls: mean(runs.map((r) => r.traceMetrics?.modelCalls)),
    toolCalls: mean(runs.map((r) => r.traceMetrics?.toolCallsTotal)),
    graders: Object.fromEntries(
      [...names].map((n) => [
        n,
        mean(
          runs.map((r) => {
            const g = r.graders.find((x) => x.name === n);
            return g ? Number(g.passed === true) : undefined;
          }),
        ) ?? 0,
      ]),
    ),
  };
}

/** Graders whose pass rate differs between two arms (a grader missing on one side counts as changed). */
export function changedGraders(a: ArmStats, b: ArmStats): string[] {
  return [
    ...new Set([...Object.keys(a.graders), ...Object.keys(b.graders)]),
  ].filter((n) => a.graders[n] !== b.graders[n]);
}

/** A case row of one repetition (`rep`, 1-based, of `of`); `arms` hold only that repetition. */
export type RepCase = EvalCase & { rep?: number; of?: number };

/** One row per repetition of the "with" arm; a case with a single repetition stays as it is. */
export function splitRepetitions(cases: EvalCase[]): RepCase[] {
  return cases.flatMap((c): RepCase[] => {
    const n = c.arms.with.length;
    if (n < 2) return [c];
    return c.arms.with.map((w, i) => {
      const wo = c.arms.without[i];
      return {
        ...c,
        rep: i + 1,
        of: n,
        arms: { with: [w], without: wo ? [wo] : [] },
        aggregates: {
          score: w.score,
          passRate: w.passed === undefined ? undefined : Number(w.passed),
          scoreWithout: wo?.score,
          delta:
            w.score !== undefined && wo?.score !== undefined
              ? w.score - wo.score
              : undefined,
        },
      };
    });
  });
}
