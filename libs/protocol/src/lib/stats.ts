import { z } from 'zod';
import type { EvalCase } from './evals.js';

/** Suite-level paired comparison over cases (see server `evals/stats.ts`). */
export const SUITE_VERDICTS = ['improved', 'regressed', 'inconclusive'] as const;
export type SuiteVerdict = (typeof SUITE_VERDICTS)[number];

export const SuiteDeltaSchema = z.object({
  /** Cases with a score on both sides. */
  cases: z.number().int(),
  /** Mean of the per-case deltas (head - base). */
  mean: z.number().optional(),
  /** 95% interval of `mean`; absent when there is too little data. */
  ci: z.tuple([z.number(), z.number()]).optional(),
  verdict: z.enum(SUITE_VERDICTS),
});
export type SuiteDelta = z.infer<typeof SuiteDeltaSchema>;

/** Run scores of one case on one side; a run without a score counts 1/0 by `passed`. */
export type RunScore = { score?: number; passed?: boolean };
export type CaseStats = { n: number; mean?: number; sd?: number; flaky: boolean };

/** Runs whose scores spread more than this (sample sd) count as flaky. */
export const FLAKY_SD = 0.25;

export const mean = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
};

/** Sample standard deviation; undefined with fewer than 2 values. */
export function sd(xs: number[]): number | undefined {
  if (xs.length < 2) return undefined;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** n, mean and sd of a case's runs; flaky = runs both pass and fail, or sd above FLAKY_SD. */
export function caseStats(runs: RunScore[]): CaseStats {
  const scores = runs.flatMap((r) => (r.score !== undefined ? [r.score] : r.passed === undefined ? [] : [Number(r.passed)]));
  const s = sd(scores);
  const verdicts = new Set(runs.flatMap((r) => (r.passed === undefined ? [] : [r.passed])));
  return {
    n: scores.length,
    ...(scores.length && { mean: mean(scores) }),
    ...(s !== undefined && { sd: s }),
    flaky: verdicts.size > 1 || (s ?? 0) > FLAKY_SD,
  };
}

/** One side of a case: the `with` arm runs of one eval result. */
export const CaseSideSchema = z.object({
  runId: z.string().optional(),
  /** Trace to open: the first failed `with` run, else the first one (1-based, like the trace route). */
  arm: z.literal('with').optional(),
  n: z.number().optional(),
  score: z.number().optional(),
  /** Including the judge. */
  costUsd: z.number().optional(),
  maxContext: z.number().optional(),
  turns: z.number().optional(),
  modelCalls: z.number().optional(),
  toolCalls: z.number().optional(),
  /** `with` arm runs behind the score, and the sd of their scores (absent with fewer than 2). */
  runs: z.number().optional(),
  sd: z.number().optional(),
  /** Runs of this case disagree (pass and fail, or a large sd). */
  flaky: z.boolean().optional(),
  /** Every `with` arm run passed. */
  passed: z.boolean().optional(),
  /** Pass rate of each grader over the runs. */
  graders: z.record(z.string(), z.number()).optional(),
});
export type CaseSide = z.infer<typeof CaseSideSchema>;
export const CaseCompareSchema = z.object({
  name: z.string(),
  from: CaseSideSchema.optional(),
  to: CaseSideSchema.optional(),
  delta: z.number().optional(),
});
export type CaseCompare = z.infer<typeof CaseCompareSchema>;

/** The one summary of a case's plugin-arm runs; trace metrics only count runs that have a trace. */
export function caseSide(c: EvalCase): CaseSide {
  const w = c.arms.with;
  const failed = w.findIndex((x) => x.passed !== true);
  const st = caseStats(w);
  const names = new Set(w.flatMap((r) => r.graders.map((g) => g.name)));
  return {
    ...(c.runId && w.length && { runId: c.runId, arm: 'with' as const, n: Math.max(failed, 0) + 1 }),
    score: c.aggregates.score ?? mean(w.map((x) => x.score)),
    costUsd: mean(w.map((x) => (x.costUsd === undefined ? undefined : x.costUsd + (x.judgeCostUsd ?? 0)))),
    maxContext: mean(w.map((x) => x.traceMetrics?.maxContext)),
    turns: mean(w.map((x) => x.traceMetrics?.numTurns ?? x.turns)),
    modelCalls: mean(w.map((x) => x.traceMetrics?.modelCalls)),
    toolCalls: mean(w.map((x) => x.traceMetrics?.toolCallsTotal)),
    ...(w.length && { runs: w.length, flaky: st.flaky }),
    ...(st.sd !== undefined && { sd: st.sd }),
    passed: w.length ? w.every((x) => x.passed === true) : undefined,
    graders: Object.fromEntries(
      [...names].map((n) => [
        n,
        mean(w.map((r) => {
          const g = r.graders.find((x) => x.name === n);
          return g ? Number(g.passed === true) : undefined;
        })) ?? 0,
      ]),
    ),
  };
}

/** Per-case rows over the union of names (`from` order first); `delta` needs both scores. */
export function compareCases(
  from: (CaseSide & { name: string })[],
  to: (CaseSide & { name: string })[],
): CaseCompare[] {
  const side = ({ name: _n, ...s }: CaseSide & { name: string }): CaseSide => s;
  const f = new Map(from.map((c) => [c.name, c]));
  const t = new Map(to.map((c) => [c.name, c]));
  return [...new Set([...f.keys(), ...t.keys()])].map((name) => {
    const a = f.get(name);
    const b = t.get(name);
    return {
      name,
      ...(a && { from: side(a) }),
      ...(b && { to: side(b) }),
      ...(a?.score !== undefined && b?.score !== undefined && { delta: b.score - a.score }),
    };
  });
}
