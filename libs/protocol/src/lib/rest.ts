import { z } from 'zod';

export const SpaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  createdAt: z.string(),
});
export type Space = z.infer<typeof SpaceSchema>;

export const CreateSpaceSchema = z.object({
  path: z.string().min(1), // absolute path; created if missing
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/), // kebab-case, goes into plugin.json
  description: z.string().default(''),
});
export type CreateSpace = z.infer<typeof CreateSpaceSchema>;

export const OpenSpaceSchema = z.object({ path: z.string().min(1) });
export type OpenSpace = z.infer<typeof OpenSpaceSchema>;

/** Optional features, all off by default; `autoCommit` and `masterLoop` need `git`. Unknown keys are dropped. */
export const FeaturesSchema = z.object({
  git: z.boolean().default(false),
  autoCommit: z.boolean().default(false),
  masterLoop: z.boolean().default(false),
  /** Load the user's ~/.claude settings into new master sessions (independent of `git`). */
  userSettings: z.boolean().default(false),
});
export type Features = z.infer<typeof FeaturesSchema>;
export type FeatureName = keyof Features;
/** Partial update (not `FeaturesSchema.partial()`: the defaults would reset omitted keys). */
export const FeaturesInputSchema = z
  .object({ git: z.boolean(), autoCommit: z.boolean(), masterLoop: z.boolean(), userSettings: z.boolean() })
  .partial();

export const SpaceConfigSchema = z.object({
  masterContext: z.array(z.string()),
  /** Id of the plan the master agent follows; missing in the file = null. */
  activePlan: z.string().nullable().default(null),
  /** The user confirmed that `claude plugin eval` may run this plugin's code; missing in the file = false. */
  evalTrusted: z.boolean().default(false),
  /** Pinned eval baselines: case name -> run id (as in `EvalCaseRun.runId`). Missing in the file = none. */
  evalBaselines: z.record(z.string(), z.string()).default({}),
  /** Labelled reference runs per case (`bare`, `sonnet`, ...), shown as badges in the run list. Hand-edited. */
  evalRefs: z.record(z.string(), z.array(z.object({ label: z.string().min(1), runId: z.string().min(1) }))).default({}),
  features: FeaturesSchema.prefault({}),
});
/** What the config PUT accepts; `activePlan` is changed through the plans API. */
export const SpaceConfigInputSchema = SpaceConfigSchema.pick({
  masterContext: true,
});
export type SpaceConfigInput = z.infer<typeof SpaceConfigInputSchema>;
export type SpaceConfig = z.infer<typeof SpaceConfigSchema>;

export const FileNodeSchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['file', 'dir']),
});
/** `path` is relative to the space root, `/`-separated; directories are listed one level at a time. */
export type FileNode = z.infer<typeof FileNodeSchema>;

export const FileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
});
export type FileContent = z.infer<typeof FileContentSchema>;

export const BrowseResultSchema = z.object({
  path: z.string(), // absolute, resolved
  parent: z.string().nullable(), // null at the filesystem root
  entries: z.array(z.object({ name: z.string() })), // subdirectories only
});
export type BrowseResult = z.infer<typeof BrowseResultSchema>;

export const SessionInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  lastModified: z.number(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

/** A Claude Code session of any project on this machine (`project` = last segment of its cwd). */
export const ProjectSessionSchema = SessionInfoSchema.extend({ project: z.string(), cwd: z.string() });
export type ProjectSession = z.infer<typeof ProjectSessionSchema>;
