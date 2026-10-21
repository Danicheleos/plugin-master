import { z } from 'zod';
import { HOOK_EVENTS, HOOK_SOURCES, HandlerSchema } from './hooks.js';

const SourceEnum = z.enum(HOOK_SOURCES);

export const HookSourceRowSchema = z.object({
  source: SourceEnum,
  /** Space-relative path. */
  file: z.string(),
  exists: z.boolean(),
  error: z.string().optional(),
});
export type HookSourceRow = z.infer<typeof HookSourceRowSchema>;

export const HooksResponseSchema = z.object({
  events: z.array(z.enum(HOOK_EVENTS)),
  sources: z.array(HookSourceRowSchema),
  entries: z.array(
    z.object({
      source: SourceEnum,
      file: z.string(),
      event: z.string(),
      group: z.number(),
      matcher: z.string().optional(),
      handlers: z.array(HandlerSchema),
      problems: z.array(z.object({ path: z.string(), message: z.string() })),
    }),
  ),
});
export type HooksResponse = z.infer<typeof HooksResponseSchema>;

/** Empty `groups` clears the event. */
export const PutHooksSchema = z.object({
  source: SourceEnum,
  file: z.string(),
  event: z.string().min(1),
  groups: z.array(z.unknown()),
});
export type PutHooks = z.infer<typeof PutHooksSchema>;
