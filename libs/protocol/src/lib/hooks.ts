import { z } from 'zod';

/** The 33 Claude Code hook events (checked against code.claude.com/docs/en/hooks). */
export const HOOK_EVENTS = [
  'SessionStart', 'Setup', 'UserPromptSubmit', 'UserPromptExpansion', 'PreToolUse',
  'PermissionRequest', 'PermissionDenied', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch',
  'Notification', 'MessageDisplay', 'SubagentStart', 'SubagentStop', 'TaskCreated',
  'TaskCompleted', 'Stop', 'StopFailure', 'TeammateIdle', 'InstructionsLoaded',
  'ConfigChange', 'CwdChanged', 'DirectoryAdded', 'FileChanged', 'WorktreeCreate',
  'WorktreeRemove', 'PreCompact', 'PostCompact', 'PreModelSwitch', 'PostModelSwitch',
  'Elicitation', 'ElicitationResult', 'SessionEnd',
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

/** Sources a plugin can contribute hooks from (user/managed levels are out of scope). */
export const HOOK_SOURCES = ['plugin', 'project', 'local', 'skill', 'agent'] as const;
export type HookSource = (typeof HOOK_SOURCES)[number];

/** Events where `matcher` is silently ignored. */
export const MATCHERLESS_EVENTS: readonly string[] = [
  'UserPromptSubmit', 'PostToolBatch', 'Stop', 'TeammateIdle', 'TaskCreated',
  'TaskCompleted', 'WorktreeCreate', 'WorktreeRemove', 'MessageDisplay', 'CwdChanged',
];

/** Events where the handler `if` (permission-rule syntax) works. */
export const TOOL_EVENTS: readonly string[] = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied',
];

export const HANDLER_TYPES = ['command', 'http', 'mcp_tool', 'prompt', 'agent'] as const;
export type HandlerType = (typeof HANDLER_TYPES)[number];

/** Default timeout in seconds per handler type (some events override it). */
export const DEFAULT_TIMEOUTS: Record<HandlerType, number> = {
  command: 600, http: 600, mcp_tool: 600, prompt: 30, agent: 60,
};

/** Lenient: unknown keys survive; field requirements are checked by `validateGroup`. */
export const HandlerSchema = z.looseObject({
  type: z.string(),
  if: z.string().optional(),
  timeout: z.number().optional(),
  once: z.boolean().optional(),
});
export type Handler = z.infer<typeof HandlerSchema>;

export const GroupSchema = z.looseObject({
  matcher: z.string().optional(),
  hooks: z.array(HandlerSchema),
});
export type Group = z.infer<typeof GroupSchema>;

export type HookProblem = { path: string; message: string };

export type HookEntry = {
  source: HookSource;
  file: string;
  /** May be an unknown event name (kept, with a problem). */
  event: string;
  /** Index inside `hooks[event]`. */
  group: number;
  matcher?: string;
  handlers: Handler[];
  problems: HookProblem[];
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Flattens `config.hooks` (same shape in every source) into entries; never throws. */
export function readHooks(source: HookSource, file: string, config: unknown): HookEntry[] {
  const hooks = isRecord(config) ? config.hooks : undefined;
  if (hooks === undefined) return [];
  if (!isRecord(hooks)) {
    return [{ source, file, event: '', group: 0, handlers: [], problems: [{ path: 'hooks', message: '`hooks` must be an object' }] }];
  }
  const out: HookEntry[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    const base = { source, file, event };
    const eventProblems: HookProblem[] = (HOOK_EVENTS as readonly string[]).includes(event)
      ? []
      : [{ path: `hooks.${event}`, message: `Unknown event "${event}"` }];
    if (!Array.isArray(groups)) {
      out.push({ ...base, group: 0, handlers: [], problems: [...eventProblems, { path: `hooks.${event}`, message: 'Must be an array of matcher groups' }] });
      continue;
    }
    groups.forEach((g, group) => {
      const path = `hooks.${event}[${group}]`;
      const problems = [...eventProblems];
      if (!isRecord(g)) {
        out.push({ ...base, group, handlers: [], problems: [...problems, { path, message: 'Matcher group must be an object' }] });
        return;
      }
      const entry: HookEntry = { ...base, group, handlers: [], problems };
      if (typeof g.matcher === 'string') entry.matcher = g.matcher;
      else if (g.matcher !== undefined) problems.push({ path: `${path}.matcher`, message: 'matcher must be a string' });
      if (!Array.isArray(g.hooks)) problems.push({ path: `${path}.hooks`, message: 'hooks must be an array' });
      else
        g.hooks.forEach((h, i) => {
          const parsed = HandlerSchema.safeParse(h);
          if (parsed.success) entry.handlers.push(parsed.data);
          else problems.push({ path: `${path}.hooks[${i}]`, message: 'Handler must be an object with a string `type`' });
        });
      out.push(entry);
    });
  }
  return out;
}

/**
 * Returns a new config with `hooks[event]` replaced; every other key is untouched.
 * Empty `groups` removes the event key, and `hooks` is removed when that leaves it empty
 * (an untouched pre-existing empty `hooks` stays).
 */
export function writeHooks<T extends object>(config: T, event: string, groups: Group[]): T {
  const base: Record<string, unknown> = isRecord(config) ? config : {};
  const old = isRecord(base.hooks) ? base.hooks : {};
  const hooks = { ...old };
  if (groups.length > 0) hooks[event] = groups;
  else if (event in hooks) delete hooks[event];
  else return { ...base } as T;
  const rest = { ...base };
  delete rest.hooks;
  return (Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest) as T;
}
