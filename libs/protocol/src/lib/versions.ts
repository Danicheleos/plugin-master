import { z } from 'zod';
import {
  CaseCompareSchema,
  SuiteDeltaSchema,
  type CaseCompare,
  type SuiteDelta,
} from './stats.js';

/** `<out>/pm-meta.json`: what the eval ran on, written by the server before each invocation. */
export const PmMetaSchema = z.object({
  commit: z.string(),
  tree: z.string(),
  /** Tracked changes outside `.plugin-master/` at run start. */
  dirty: z.boolean(),
  branch: z.string().optional(),
  spaceId: z.string(),
  startedAt: z.string(),
});
export type PmMeta = z.infer<typeof PmMetaSchema>;

// Plain response types of the versions API (produced by our own server code).
/** Latest eval group of a commit (the latest trendable one when there is one). */
export type VersionEval = {
  groupId: string;
  runIds: string[];
  score?: number;
  casesPassed?: number;
  casesTotal?: number;
  costUsd?: number;
  partial?: boolean;
  skippedPaid?: boolean;
  /** Some run was mapped to the commit by time, not by a sidecar. */
  approx?: boolean;
  /** Some run started on a dirty tree (counted as the commit). */
  dirty?: boolean;
};
export type VersionEntry = {
  hash: string;
  date: string;
  message: string;
  author: string;
  eval?: VersionEval;
  /** Has a run with neither `partial` nor `skippedPaid`. */
  trendable: boolean;
  /** `score` minus the score of the previous trendable commit. */
  delta?: number;
};
export type VersionsResponse = { commits: VersionEntry[] };

export type { CaseCompare, CaseSide } from './stats.js';
export type VersionSide = {
  hash: string;
  groupId?: string;
  approx?: boolean;
  dirty?: boolean;
};
export type SkillSize = { skill: string; bytes: number };
export type VersionsCompare = {
  from: VersionSide;
  to: VersionSide;
  files: { status: string; path: string }[];
  cases: CaseCompare[];
  suite: SuiteDelta;
  /** Bytes of SKILL.md description + body. */
  skillContext: {
    from: SkillSize[];
    to: SkillSize[];
    fromBytes: number;
    toBytes: number;
  };
};

export type GateStatus = 'pass' | 'fail' | 'unknown';
export type GateRule = {
  id: 'no-regression' | 'ctx-not-grown' | 'holdout-pass';
  status: GateStatus;
  message: string;
  cases?: string[];
};
export type VersionsGate = {
  from: VersionSide;
  to: VersionSide;
  status: GateStatus;
  rules: GateRule[];
  /** Dirty or time-mapped runs: the result is less certain. */
  warnings: string[];
  suite: SuiteDelta;
};

// Runtime schemas for the web client (the annotations keep them in step with the types above).
const VersionEvalSchema: z.ZodType<VersionEval> = z.object({
  groupId: z.string(),
  runIds: z.array(z.string()),
  score: z.number().optional(),
  casesPassed: z.number().optional(),
  casesTotal: z.number().optional(),
  costUsd: z.number().optional(),
  partial: z.boolean().optional(),
  skippedPaid: z.boolean().optional(),
  approx: z.boolean().optional(),
  dirty: z.boolean().optional(),
});
export const VersionsResponseSchema: z.ZodType<VersionsResponse> = z.object({
  commits: z.array(
    z.object({
      hash: z.string(),
      date: z.string(),
      message: z.string(),
      author: z.string(),
      eval: VersionEvalSchema.optional(),
      trendable: z.boolean(),
      delta: z.number().optional(),
    }),
  ),
});
const VersionSideSchema: z.ZodType<VersionSide> = z.object({
  hash: z.string(),
  groupId: z.string().optional(),
  approx: z.boolean().optional(),
  dirty: z.boolean().optional(),
});
const SkillSizesSchema = z.array(
  z.object({ skill: z.string(), bytes: z.number() }),
);
export const VersionsCompareSchema: z.ZodType<VersionsCompare> = z.object({
  from: VersionSideSchema,
  to: VersionSideSchema,
  files: z.array(z.object({ status: z.string(), path: z.string() })),
  cases: z.array(CaseCompareSchema),
  suite: SuiteDeltaSchema,
  skillContext: z.object({
    from: SkillSizesSchema,
    to: SkillSizesSchema,
    fromBytes: z.number(),
    toBytes: z.number(),
  }),
});
export const VersionsGateSchema: z.ZodType<VersionsGate> = z.object({
  from: VersionSideSchema,
  to: VersionSideSchema,
  status: z.enum(['pass', 'fail', 'unknown']),
  rules: z.array(
    z.object({
      id: z.enum(['no-regression', 'ctx-not-grown', 'holdout-pass']),
      status: z.enum(['pass', 'fail', 'unknown']),
      message: z.string(),
      cases: z.array(z.string()).optional(),
    }),
  ),
  warnings: z.array(z.string()),
  suite: SuiteDeltaSchema,
});
