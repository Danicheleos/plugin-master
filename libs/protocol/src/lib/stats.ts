import { z } from 'zod';

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
