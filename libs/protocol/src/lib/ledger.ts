import { z } from 'zod';
import { EXPERIMENT_KINDS } from './experiments.js';
import { SuiteDeltaSchema } from './stats.js';

export const CHANGE_TYPES = ['description', 'instructions', 'examples', 'structure', 'hooks', 'scripts', 'other'] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

/**
 * One line of `.plugin-master/ledger.jsonl`: an evaluated experiment. Merge or rollback is a follow-up
 * `LedgerOutcome` line (the file is append-only); readers fold it into `merged`.
 */
export const LedgerRecordSchema = z.object({
  id: z.string(),
  at: z.string(),
  experiment: z.number().int().positive(),
  kind: z.enum(EXPERIMENT_KINDS),
  skills: z.array(z.string()),
  files: z.array(z.string()),
  changeType: z.enum(CHANGE_TYPES),
  hypothesis: z.string(),
  diffSummary: z.string(),
  diffStat: z.object({ files: z.number().int(), additions: z.number().int(), deletions: z.number().int() }),
  base: z.string(),
  head: z.string().optional(),
  /** eval runs behind the comparison: baseline first (when there was one), then the experiment's */
  evalRunIds: z.array(z.string()),
  suite: SuiteDeltaSchema.optional(),
  cases: z.array(z.object({
    case: z.string(),
    delta: z.number().optional(),
    n: z.number().int().optional(),
    flaky: z.boolean().optional(),
  })),
  /** description optimizer: train/holdout score of the original and of the best candidate */
  holdout: z.object({ before: z.number().optional(), after: z.number().optional() }).optional(),
  /** true = merged, false = discarded, null = not decided yet */
  merged: z.boolean().nullable(),
  /** one sentence from the analyst: what this change taught */
  lesson: z.string().optional(),
  costUsd: z.number(),
});
export type LedgerRecord = z.infer<typeof LedgerRecordSchema>;

export const LedgerOutcomeSchema = z.object({
  event: z.literal('outcome'),
  experiment: z.number().int().positive(),
  merged: z.boolean(),
  at: z.string(),
});
export type LedgerOutcome = z.infer<typeof LedgerOutcomeSchema>;
