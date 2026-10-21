import { z } from 'zod';
import type { GitDiff } from './git.js';
import { SuiteDeltaSchema } from './stats.js';

export const LOOP_STAGES = ['hypothesis', 'execute', 'eval', 'analyze', 'propose'] as const;
export type LoopStage = (typeof LOOP_STAGES)[number];

/** Progress of one loop stage; `runId` = the recorded SDK run (stages) or the eval run dir in the worktree. */
export const StageInfoSchema = z.object({
  runId: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  costUsd: z.number().optional(),
  error: z.string().optional(),
});
export type StageInfo = z.infer<typeof StageInfoSchema>;

/** Per-case score of the experiment's eval vs the baseline (latest result in the space). */
export const ExperimentComparisonSchema = z.object({
  /** null: the space had no earlier eval result of these cases */
  baseline: z.object({ runId: z.string() }).nullable(),
  cases: z.array(
    z.object({
      case: z.string(),
      score: z.number().optional(),
      baselineScore: z.number().optional(),
      /** runs per side, and the sd of their scores (absent with fewer than 2 runs) */
      n: z.number().int().optional(),
      sd: z.number().optional(),
      baselineN: z.number().int().optional(),
      baselineSd: z.number().optional(),
      delta: z.number().optional(),
      /** runs of this case disagree (pass and fail, or a large sd) on either side */
      flaky: z.boolean().optional(),
    }),
  ),
  /** absent in records from before the stats core */
  suite: SuiteDeltaSchema.optional(),
});
export type ExperimentComparison = z.infer<typeof ExperimentComparisonSchema>;

/** `hypothesis` (also: no `kind`, old records) = the master loop; `description` = the skill description optimizer. */
export const EXPERIMENT_KINDS = ['hypothesis', 'description'] as const;
export type ExperimentKind = (typeof EXPERIMENT_KINDS)[number];

/** One description tried by the optimizer; the first candidate is the original. Scores are 0..1, absent = no such cases. */
export const DescriptionCandidateSchema = z.object({
  text: z.string(),
  train: z.number().optional(),
  holdout: z.number().optional(),
  costUsd: z.number(),
  /** the proposer stage run and the eval run (dir in the worktree) behind it */
  proposeRunId: z.string().optional(),
  evalRunId: z.string().optional(),
});
export type DescriptionCandidate = z.infer<typeof DescriptionCandidateSchema>;

export const DESCRIPTION_VERDICTS = ['pass', 'fail', 'unknown'] as const;
/** Outcome of a description experiment; `bestIndex` points into `candidates`. */
export const DescriptionResultSchema = z.object({
  bestIndex: z.number().int().min(0),
  /** pass: the best candidate's hold-out score is not below the original's; unknown: no hold-out cases */
  verdict: z.enum(DESCRIPTION_VERDICTS),
  warning: z.string().optional(),
});
export type DescriptionResult = z.infer<typeof DescriptionResultSchema>;

export const EXPERIMENT_STATUSES = ['created', 'running', 'ready', 'merged', 'discarded', 'failed'] as const;

/** `.plugin-master/experiments/<n>.json`: one experiment = branch `exp/<n>` in its own git worktree. */
export const ExperimentSchema = z.object({
  id: z.number().int().positive(),
  branch: z.string(),
  /** commit the experiment started from */
  base: z.string().regex(/^[0-9a-f]{40,64}$/),
  worktree: z.string(),
  status: z.enum(EXPERIMENT_STATUSES),
  stage: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  hypothesis: z.string().optional(),
  result: z.string().optional(),
  error: z.string().optional(),
  // loop (all optional: manually created experiments have none)
  maxCostUsd: z.number().optional(),
  focus: z.string().optional(),
  cases: z.array(z.string()).optional(),
  /** sum of the stages' costs */
  costUsd: z.number().optional(),
  stages: z.partialRecord(z.enum(LOOP_STAGES), StageInfoSchema).optional(),
  plan: z.lazy(() => HypothesisSchema).optional(),
  execution: z.lazy(() => ExecutionSummarySchema).optional(),
  /** paths changed on the branch */
  files: z.array(z.string()).optional(),
  comparison: ExperimentComparisonSchema.optional(),
  analysis: z.lazy(() => AnalysisSchema).optional(),
  /** text appended to STATE.md on merge; written nowhere before */
  stateProposal: z.string().optional(),
  // description optimizer (kind 'description')
  kind: z.enum(EXPERIMENT_KINDS).optional(),
  skill: z.string().optional(),
  iterations: z.number().int().optional(),
  /** trigger case names used for scoring */
  trainCases: z.array(z.string()).optional(),
  holdoutCases: z.array(z.string()).optional(),
  candidates: z.array(DescriptionCandidateSchema).optional(),
  descriptionResult: DescriptionResultSchema.optional(),
});
export type Experiment = z.infer<typeof ExperimentSchema>;

export const CreateExperimentSchema = z.object({ hypothesis: z.string().trim().min(1).optional() });

/** Files changed between base and the worktree (committed and uncommitted), at most 200. */
export type ExperimentDiff = { files: GitDiff[]; truncated?: boolean };

export const STAGE_ROLES = ['master', 'executor', 'analyst'] as const;
export type StageRole = (typeof STAGE_ROLES)[number];

/** Master stage: exactly one minimal hypothesis. */
export const HypothesisSchema = z.object({
  title: z.string().min(1),
  rationale: z.string().min(1),
  /** expected effect per named eval case */
  expectedEffect: z.array(z.object({ case: z.string(), effect: z.string() })),
  files: z.array(z.string()),
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;

/** Executor stage: what was changed. */
export const ExecutionSummarySchema = z.object({
  summary: z.string().min(1),
  filesChanged: z.array(z.string()),
});
export type ExecutionSummary = z.infer<typeof ExecutionSummarySchema>;

/** Analyst stage: verdict on the change. */
export const AnalysisSchema = z.object({
  verdict: z.enum(['improve', 'regress', 'neutral', 'inconclusive']),
  reasons: z.array(z.string()),
  cases: z.array(z.object({ case: z.string(), note: z.string() })),
  recommendation: z.enum(['merge', 'discard', 'iterate']),
  /** one sentence: what this change taught (absent in records from before the ledger) */
  lesson: z.string().optional(),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export const RunExperimentSchema = z
  .object({
    maxCostUsd: z.number().positive().max(20),
    focus: z.string().trim().min(1).max(2000).optional(),
    cases: z.array(z.string().min(1).regex(/^[^-]/)).max(200).optional(),
    kind: z.enum(EXPERIMENT_KINDS).optional(),
    /** description: the skill directory name under `skills/` */
    skill: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/).optional(),
    /** description: proposer rounds, default 3 */
    iterations: z.number().int().min(1).max(5).optional(),
    /** Pass `--scaffold` to the eval stage (scaffold scripts run as the user). */
    scaffold: z.boolean().optional(),
    /** Eval runs per case; default 3 (single runs cannot tell a change from noise). */
    runs: z.number().int().min(1).max(10).optional(),
  })
  .refine((r) => r.kind !== 'description' || !!r.skill, { message: 'skill is required', path: ['skill'] });
export type RunExperiment = z.infer<typeof RunExperimentSchema>;

export const TRIGGER_TAG = 'trigger';
export const HOLDOUT_TAG = 'holdout';
export const MAX_DESCRIPTION = 1024;

/** Trigger cases (tag `trigger`, parsable) split into train and hold-out (also tagged `holdout`); names only. */
export function splitTriggerCases(cases: { name: string; tags: string[]; error?: string }[]) {
  const trigger = cases.filter((c) => !c.error && c.tags.includes(TRIGGER_TAG));
  const names = (hold: boolean) => trigger.filter((c) => c.tags.includes(HOLDOUT_TAG) === hold).map((c) => c.name);
  return { train: names(false), holdout: names(true) };
}

/** Description optimizer proposer stage: the complete new description. */
export const DescriptionProposalSchema = z.object({ description: z.string() });
export type DescriptionProposal = z.infer<typeof DescriptionProposalSchema>;
