import {
  caseSide,
  compareCases,
  type CaseCompare,
  type CaseSide,
  type EvalCase,
} from '@pm/protocol';

/** Graders whose pass rate differs between two sides (a grader missing on one side counts as changed). */
export function changedGraders(a: CaseSide, b: CaseSide): string[] {
  const [x, y] = [a.graders ?? {}, b.graders ?? {}];
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(
    (n) => x[n] !== y[n],
  );
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

/** Names that occur more than once (one pass). */
export function repeatedCaseNames(cases: { name: string }[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const { name } of cases) {
    if (seen.has(name)) repeated.add(name);
    else seen.add(name);
  }
  return repeated;
}

/** One case per name, the last occurrence (the latest invocation), in order of first appearance. */
export function latestPerCase<T extends { name: string }>(cases: T[]): T[] {
  return [...new Map(cases.map((c) => [c.name, c])).values()];
}

/** `initialBaseline` of a compare request (and `EvalCompare`'s prop): the run's own without arm. */
export const ABLATION_BASELINE = 'ablation';

/** What a run is compared against: its own without arm, one run, or a group (merged view). */
export type Baseline =
  | { kind: 'ablation' }
  | { kind: 'run'; runId: string }
  | { kind: 'group'; groupId: string };

/** The string of a baseline in a select (`ablation`, `run:<id>`, `group:<id>`); inverse of `parseBaseline`. */
export const baselineKey = (b: Baseline): string =>
  b.kind === 'ablation'
    ? 'ablation'
    : b.kind === 'run'
      ? `run:${b.runId}`
      : `group:${b.groupId}`;

export function parseBaseline(key: string): Baseline {
  if (key.startsWith('run:')) return { kind: 'run', runId: key.slice(4) };
  if (key.startsWith('group:')) return { kind: 'group', groupId: key.slice(6) };
  return { kind: 'ablation' };
}

/** The without arm of a case as if it were a plugin-arm result, to compare the case against itself. */
export function ablationAsBaseline(c: EvalCase): EvalCase {
  return { ...c, arms: { with: c.arms.without, without: [] }, aggregates: {} };
}

/**
 * Rows `baseline` -> `cases`, one per case that has a counterpart: the case's own without arm for
 * `'ablation'`, else the case of the same name in `baseline` (missing = no row).
 */
export function compareToBaseline(
  cases: EvalCase[],
  baseline: EvalCase[] | 'ablation',
): CaseCompare[] {
  const from: (CaseSide & { name: string })[] = [];
  const to: (CaseSide & { name: string })[] = [];
  for (const c of cases) {
    const b =
      baseline === 'ablation'
        ? ablationAsBaseline(c)
        : baseline.find((x) => x.name === c.name);
    if (!b) continue;
    from.push({ name: c.name, ...caseSide(b) });
    to.push({ name: c.name, ...caseSide(c) });
  }
  return compareCases(from, to);
}
