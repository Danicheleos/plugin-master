import type { CaseSide, EvalCase } from '@pm/protocol';

/** Graders whose pass rate differs between two sides (a grader missing on one side counts as changed). */
export function changedGraders(a: CaseSide, b: CaseSide): string[] {
  const [x, y] = [a.graders ?? {}, b.graders ?? {}];
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((n) => x[n] !== y[n]);
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
