import { z } from 'zod';

/** `.plugin-master/runs/<id>/meta.json`: one recorded chat/master session. */
export const RunMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  turns: z.number(),
  costUsd: z.number(),
  models: z.array(z.string()),
  claudeVersion: z.string().optional(),
  commit: z.string().optional(),
  /** Session id this run was resumed from, when the SDK assigned a new one. */
  resumedFrom: z.string().optional(),
});
export type RunMeta = z.infer<typeof RunMetaSchema>;

/** A run whose meta.json is missing or broken. */
export type RunError = { id: string; error: string };
export type RunsResponse = { runs: (RunMeta | RunError)[] };

export const RunsResponseSchema = z.object({
  runs: z.array(z.union([RunMetaSchema, z.object({ id: z.string(), error: z.string() })])),
});
