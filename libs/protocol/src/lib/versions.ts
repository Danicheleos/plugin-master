import { z } from 'zod';
import type { SuiteDelta } from './stats.js';

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

export type CaseSide = {
  runId?: string;
  /** Trace to open: the first failed `with` run, else the first one (1-based, like the trace route). */
  arm?: 'with' | 'without';
  n?: number;
  score?: number;
  costUsd?: number;
  maxContext?: number;
  turns?: number;
  /** `with` arm runs behind the score, and the sd of their scores (absent with fewer than 2). */
  runs?: number;
  sd?: number;
  /** Runs of this case disagree (pass and fail, or a large sd). */
  flaky?: boolean;
  /** Every `with` arm run passed. */
  passed?: boolean;
};
export type CaseCompare = { name: string; from?: CaseSide; to?: CaseSide; delta?: number };
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
  skillContext: { from: SkillSize[]; to: SkillSize[]; fromBytes: number; toBytes: number };
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
