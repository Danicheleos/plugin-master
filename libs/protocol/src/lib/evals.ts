import { z } from 'zod';
import { TraceMetricsSchema } from './eval-trace.js';

// Lenient on purpose: `aggregate-result.json` is additive-only and only partly documented.
const loose = <T extends z.ZodRawShape>(shape: T) => z.looseObject(shape);

export const EvalGraderResultSchema = loose({
  name: z.string(),
  passed: z.boolean().optional(),
  weight: z.number().optional(),
  explanation: z.string().optional(),
  withOnly: z.boolean().optional(),
  scored: z.boolean().optional(),
  judgeVotes: z.array(z.unknown()).optional(),
  evidence: z.string().optional(),
});
export type EvalGraderResult = z.infer<typeof EvalGraderResultSchema>;

export const EvalRunResultSchema = loose({
  score: z.number().optional(),
  passed: z.boolean().optional(),
  turns: z.number().optional(),
  costUsd: z.number().optional(),
  judgeCostUsd: z.number().optional(),
  durationSeconds: z.number().optional(),
  error: z.string().nullable().optional(),
  skippedPaidGraders: z.boolean().optional(),
  /** Path inside the CLI's sandbox (gone after the run); the harvested copy is found by case/arm/index. */
  tracePath: z.string().nullable().optional(),
  /** Added by the server when a trace exists for this run (`metrics` is a harness field of its own). */
  traceMetrics: TraceMetricsSchema.optional(),
  /** Retrieval metrics some harnesses add per run (null = undefined, e.g. no files named); other shapes are dropped. */
  metrics: loose({
    recall: z.number().nullable().optional(),
    precision: z.number().nullable().optional(),
    f1: z.number().nullable().optional(),
  })
    .optional()
    .catch(undefined),
  graders: z.array(EvalGraderResultSchema).default([]),
});
export type EvalRunResult = z.infer<typeof EvalRunResultSchema>;

export const EvalCaseSchema = loose({
  name: z.string(),
  /** Set in a merged group view: the run (invocation) this case comes from. */
  runId: z.string().optional(),
  dir: z.string().optional(),
  graders: z
    .array(
      loose({
        name: z.string(),
        type: z.string().optional(),
        weight: z.number().optional(),
        graderMarkdown: z.string().optional(),
      }),
    )
    .default([]),
  arms: loose({
    with: z.array(EvalRunResultSchema).default([]),
    without: z.array(EvalRunResultSchema).default([]),
  }).default({ with: [], without: [] }),
  aggregates: loose({
    score: z.number().optional(),
    passRate: z.number().optional(),
    scoreWithout: z.number().optional(),
    delta: z.number().optional(),
  }).default({}),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalResultSchema = loose({
  schemaVersion: z.number().optional(),
  claudeVersion: z.string().optional(),
  startedAt: z.string().optional(),
  durationSeconds: z.number().optional(),
  costUsd: z.number().optional(),
  partial: z.boolean().optional(),
  partialReason: z.string().nullable().optional(),
  suite: loose({
    root: z.string().optional(),
    ablation: z.string().optional(),
    modelOverride: z.string().nullable().optional(),
    threshold: z.number().nullable().optional(),
    plugins: z.array(loose({ name: z.string().optional(), version: z.string().optional() })).optional(),
  }).default({}),
  cases: z.array(EvalCaseSchema).default([]),
  aggregates: loose({
    casesTotal: z.number().optional(),
    casesPassed: z.number().optional(),
    overallScore: z.number().optional(),
    overallPassRate: z.number().optional(),
  }).default({}),
});
export type EvalResult = z.infer<typeof EvalResultSchema>;

export const EvalRunSummarySchema = z.object({
  /** Path of the results dir relative to the eval dir's `results/`, e.g. `2026-10-17T10-00-00Z`. */
  id: z.string(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  overallScore: z.number().optional(),
  overallPassRate: z.number().optional(),
  casesPassed: z.number().optional(),
  casesTotal: z.number().optional(),
  ablation: z.string().optional(),
  threshold: z.number().nullable().optional(),
  modelOverride: z.string().nullable().optional(),
  costUsd: z.number().optional(),
  durationSeconds: z.number().optional(),
  claudeVersion: z.string().optional(),
  pluginVersion: z.string().optional(),
  partial: z.boolean().optional(),
  partialReason: z.string().nullable().optional(),
  /** Some run skipped its paid graders: not comparable in trends. */
  skippedPaid: z.boolean().optional(),
  hasReport: z.boolean().optional(),
});
export type EvalRunSummary = z.infer<typeof EvalRunSummarySchema>;

/** Runs of one logical eval (e.g. one harness invoking the CLI per case), see server `evals/groups.ts`. */
export const EvalGroupSchema = z.object({
  /** Id of the first run. */
  id: z.string(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  runIds: z.array(z.string()),
  runs: z.array(EvalRunSummarySchema),
  /** Total arm runs over all cases. */
  totalRuns: z.number(),
  score: z.number().optional(),
  casesPassed: z.number().optional(),
  /** Distinct cases. */
  casesTotal: z.number().optional(),
  threshold: z.number().nullable().optional(),
  costUsd: z.number().optional(),
  /** Wall time from the first start to the last end. */
  durationSeconds: z.number().optional(),
  modelOverride: z.string().nullable().optional(),
  ablation: z.string().optional(),
  claudeVersion: z.string().optional(),
  pluginVersion: z.string().optional(),
  partial: z.boolean().optional(),
  skippedPaid: z.boolean().optional(),
});
export type EvalGroup = z.infer<typeof EvalGroupSchema>;

/**
 * Live state of a series launched outside plugin-master, written by that tool to
 * `<evalDir>/results/running.json` (no `schemaVersion`, so it is never listed as a run).
 */
export const ExternalSeriesSchema = z.object({
  kind: z.literal('eval-series'),
  series: z.string(),
  arm: z.enum(['plugin', 'bare']),
  startedAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().nullable(),
  runsPerCase: z.number(),
  total: z.number(),
  done: z.number(),
  current: z.string().nullable(),
  costUsd: z.number(),
  cases: z.array(
    z.object({
      name: z.string(),
      state: z.enum(['queued', 'running', 'done', 'failed']),
      score: z.number().nullable(),
      costUsd: z.number().nullable(),
    }),
  ),
});
export type ExternalSeries = z.infer<typeof ExternalSeriesSchema>;

export const EvalRunsResponseSchema = z.object({
  /** Eval dir relative to the space root (web watches `<dir>/results`). */
  dir: z.string(),
  /** Newest first. */
  groups: z.array(EvalGroupSchema),
  /** A series running (or just finished) outside plugin-master; null/absent when none is live. */
  external: ExternalSeriesSchema.nullable().optional(),
});
export type EvalRunsResponse = z.infer<typeof EvalRunsResponseSchema>;

/** One run of one case (mean over its `with` arm runs), see server `evals/suites.ts`. */
export const EvalCaseRunSchema = z.object({
  runId: z.string(),
  startedAt: z.string().optional(),
  model: z.string().nullable(),
  score: z.number().optional(),
  /** Score of the baseline this run is listed under; `delta` = `score - baselineScore`. */
  baselineScore: z.number().optional(),
  delta: z.number().optional(),
  /** Including the judge. */
  costUsd: z.number().optional(),
  turns: z.number().optional(),
  /** Only when a trace exists. */
  maxContext: z.number().optional(),
  /** Input + output tokens of the trace (no cache); only when a trace exists. */
  tokens: z.number().optional(),
  /** Mean retrieval metrics of the `with` arm runs that report them (harness `metrics`). */
  recall: z.number().optional(),
  precision: z.number().optional(),
  f1: z.number().optional(),
  /** Wall time of the run: the trace's, else the harness' `durationSeconds`. */
  durationMs: z.number().optional(),
  /** Share of the `with` arm runs that passed, 0..1. */
  passRate: z.number().optional(),
  /** This run is the pinned baseline of its case (`evalBaselines` in the space config). */
  pinned: z.boolean().optional(),
  /** Labels of `evalRefs` that point at this run. */
  refs: z.array(z.string()).optional(),
  /** Full commit hash from the run's `pm-meta.json` sidecar. */
  commit: z.string().optional(),
  /** Same metrics of the baseline this run is listed under (the `without` arm or the baseline run); missing ones are absent. */
  baselineMetrics: z
    .object({
      score: z.number().optional(),
      passRate: z.number().optional(),
      costUsd: z.number().optional(),
      turns: z.number().optional(),
      maxContext: z.number().optional(),
      tokens: z.number().optional(),
      recall: z.number().optional(),
      precision: z.number().optional(),
      f1: z.number().optional(),
      durationMs: z.number().optional(),
    })
    .optional(),
});
export type EvalCaseRun = z.infer<typeof EvalCaseRunSchema>;

/** Runs of a case compared with the same baseline. Newest first. */
export const EvalBaselineSectionSchema = z.object({
  /** `run`: a baseline-suite run; `ablation`: the run's own `without` arm; `none`. */
  kind: z.enum(['run', 'ablation', 'none']),
  /** `kind` run only. `after`: no baseline run started before the compared run, this is the nearest later one. */
  baseline: z
    .object({
      runId: z.string(),
      startedAt: z.string().optional(),
      score: z.number().optional(),
      model: z.string().nullable(),
      after: z.boolean(),
      /** The user's pin, not the auto-picked baseline. */
      pinned: z.boolean().optional(),
  /** Labels of `evalRefs` that point at this run. */
  refs: z.array(z.string()).optional(),
    })
    .optional(),
  runs: z.array(EvalCaseRunSchema),
});
export type EvalBaselineSection = z.infer<typeof EvalBaselineSectionSchema>;

export const EvalCaseEntrySchema = z.object({
  name: z.string(),
  runCount: z.number(),
  lastRunAt: z.string().optional(),
  latest: EvalCaseRunSchema,
  /** Run id pinned as this case's baseline, but no run of the case has it any more: the pin is ignored. */
  stalePin: z.string().optional(),
  /** Scores of the last runs, oldest first. */
  trend: z.array(z.number()),
  sections: z.array(EvalBaselineSectionSchema),
});
export type EvalCaseEntry = z.infer<typeof EvalCaseEntrySchema>;

export const EvalSuiteEntrySchema = z.object({
  /** Plugin name + eval dir prefix of the cases, e.g. `naked · evals/bare`. */
  key: z.string(),
  label: z.string(),
  /** `main`: the space's plugin; `baseline`: another suite sharing case names with a main one. */
  kind: z.enum(['main', 'baseline', 'other']),
  runCount: z.number(),
  cases: z.array(EvalCaseEntrySchema),
});
export type EvalSuiteEntry = z.infer<typeof EvalSuiteEntrySchema>;

/** `runId` null removes the pin of the case. */
export const EvalBaselinePinSchema = z.object({
  case: z.string().min(1),
  runId: z.string().min(1).nullable(),
});
export type EvalBaselinePin = z.infer<typeof EvalBaselinePinSchema>;

export const EvalSuitesResponseSchema = z.object({
  dir: z.string(),
  /** Main suites first, then baseline, then other; newest first within a kind. */
  suites: z.array(EvalSuiteEntrySchema),
});
export type EvalSuitesResponse = z.infer<typeof EvalSuitesResponseSchema>;

/**
 * Cases of one skill or agent of the plugin; `runs` aggregate its cases per run (mean per metric,
 * `maxContext` = max), newest first, with `baselineMetrics` aggregated the same way.
 */
export const EvalTargetSchema = z.object({
  name: z.string(),
  /** `lastRunId`: the case's latest run, to open it; `runs`: every run of the case in the main suites, newest first. */
  cases: z.array(z.object({ name: z.string(), lastRunId: z.string().optional(), runs: z.array(EvalCaseRunSchema).default([]) })),
  runs: z.array(EvalCaseRunSchema),
  /** Bytes of `skills/<name>/SKILL.md` or `agents/<name>.md` in the working tree. */
  contextBytes: z.number().optional(),
});
export type EvalTarget = z.infer<typeof EvalTargetSchema>;

export const EvalTargetsResponseSchema = z.object({
  targets: z.array(EvalTargetSchema.extend({ kind: z.enum(['skill', 'agent']) })),
  /** Cases that name no skill or agent. */
  unmapped: EvalTargetSchema,
});
export type EvalTargetsResponse = z.infer<typeof EvalTargetsResponseSchema>;

export const EvalRunResponseSchema = z.object({
  id: z.string(),
  /** `schemaVersion` is not 1: shown with a warning. */
  unknownSchema: z.boolean(),
  result: EvalResultSchema,
});
export type EvalRunResponse = z.infer<typeof EvalRunResponseSchema>;

/** Merged view of a group: every case of every invocation in start order, each tagged with its `runId`. */
export const EvalGroupResponseSchema = EvalRunResponseSchema.extend({
  group: EvalGroupSchema,
});
export type EvalGroupResponse = z.infer<typeof EvalGroupResponseSchema>;

// Values go to a process argv: no leading `-` (option injection) and no NUL.
const argValue = z
  .string()
  .min(1)
  .refine((s) => !s.startsWith('-') && !s.includes('\0'), 'Invalid value');

export const EvalRunRequestSchema = z.object({
  /** Case names (`--case`); empty or absent = all. */
  cases: z.array(argValue).max(200).optional(),
  tags: z.array(argValue).max(20).optional(),
  runs: z.number().int().min(1).max(50).optional(),
  maxCostUsd: z.number().positive(),
  model: argValue.optional(),
  /** Also run a no-plugin baseline arm (`--ablation with-without`, about 2x cost). */
  ablation: z.boolean().optional(),
  /** Run each case's `scaffold_script` (`--scaffold`): author-supplied bash that runs as the user. Default off. */
  scaffold: z.boolean().optional(),
  /** Operator grant for gated tools (`--allow-tools`): a case's `allowed_tools` never grants Bash/Write/Edit/WebFetch/mcp__* itself. */
  allowTools: z.array(argValue).max(20).optional(),
});
export type EvalRunRequest = z.infer<typeof EvalRunRequestSchema>;

/** A case found in the eval dir (`GET …/evals/suite`). */
export const EvalSuiteCaseSchema = z.object({
  name: z.string(),
  /** Relative to the space root. */
  dir: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()),
  /** `tool_used` graders (case.yaml and graders/*.md): used to map the case to skills/agents. */
  toolGraders: z.array(z.object({ tool: z.string(), inputMatch: z.string().optional() })).optional(),
  /** The case does not parse: it is listed but not selectable by tag. */
  error: z.string().optional(),
});
export type EvalSuiteCase = z.infer<typeof EvalSuiteCaseSchema>;

export const EvalSuiteSchema = z.object({
  cases: z.array(EvalSuiteCaseSchema),
  tags: z.array(z.string()),
});
export type EvalSuite = z.infer<typeof EvalSuiteSchema>;

export const EvalTrustSchema = z.object({ trusted: z.boolean() });

export type EvalState = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';
/** State of one case (one CLI invocation) of a run. */
export type EvalCaseState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type EvalProgress = {
  total: number;
  /** Cases that are no longer queued or running. */
  done: number;
  current: string | null;
  cases: { name: string; state: EvalCaseState; score?: number }[];
};
export type EvalStatus = {
  state: EvalState;
  /** Per-case progress; absent when the run has no known case list (one invocation for everything). */
  progress?: EvalProgress;
  exitCode?: number;
  /** Results dir relative to `<evalDir>/results`, as in `EvalRunSummary.id`. */
  runId?: string;
  startedAt?: string;
};
export type EvalLine = { line: string; stream: 'stdout' | 'stderr' };
