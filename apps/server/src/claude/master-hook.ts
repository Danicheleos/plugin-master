import { stat } from 'node:fs/promises';
import type { AgentDefinition, HookCallback, HookCallbackMatcher, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { AgentTask } from '@pm/protocol';
import { buildContext } from '../context/build-context';
import { resolveInSpace } from '../files/safe-path';

/**
 * Allow-list of the master's own tools: planning, delegation, asking the user, and reading/small
 * edits of files (the prompt asks it to delegate anything larger). Everything else (shell, web,
 * notebook, MCP resources and tools of the project's `.mcp.json`, tools loaded by ToolSearch) is
 * denied, so a tool missing from a deny list cannot leak access.
 */
const MASTER_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'Agent', 'Task', 'TaskOutput', 'TaskStop', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate',
  'Read', 'Glob', 'Grep', 'Edit', 'Write', 'ListAgents',
  'TodoWrite', 'ToolSearch', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'Skill', 'SendMessage',
]);
/** In-process MCP servers of the app. */
const OWN_MCP_PREFIXES = ['mcp__plan__', 'mcp__evals__'];

/** MCP tools that always need the user's confirmation, also in auto/dontAsk modes. */
const ALWAYS_ASK_TOOLS: ReadonlySet<string> = new Set(['mcp__evals__eval_run']);

const TASK_OUTPUT = /[\\/]tasks[\\/][^\\/]+\.output$/;

const pre = (permissionDecision: 'deny' | 'ask', permissionDecisionReason: string): HookJSONOutput => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason },
});

/**
 * PreToolUse hook of the master session. Hooks run before the permission mode is applied, so
 * this holds in every mode. `agent_id` is set only when the call comes from a subagent.
 */
export const createMasterPreToolUse = (agents: Record<string, AgentDefinition>): HookCallback => async (input) => {
  if (input.hook_event_name !== 'PreToolUse') return {};
  // costs money: asks for subagents too (auto/dontAsk must not approve it)
  if (ALWAYS_ASK_TOOLS.has(input.tool_name))
    return pre('ask', 'Eval runs cost money: the user must confirm.');
  if (input.agent_id) return {};
  // the master read a 37 KB subagent transcript this way instead of delegating; the dir is the
  // Claude temp dir (differs per OS and user), so only the path shape is matched
  if (input.tool_name === 'Read') {
    const path = (input.tool_input as { file_path?: unknown } | null)?.file_path;
    if (typeof path === 'string' && TASK_OUTPUT.test(path))
      return pre('deny', 'Subagent output files are full transcripts: do not read them. The agent\'s report arrives in its notification; delegate any further reading to a reader.');
  }
  // opus or higher for a subagent only on the user's command; the prompt alone did not hold it
  if (input.tool_name === 'Agent' || input.tool_name === 'Task') {
    const call = input.tool_input as { model?: unknown; subagent_type?: unknown } | null;
    const type = typeof call?.subagent_type === 'string' ? call.subagent_type : undefined;
    const def = type && Object.hasOwn(agents, type) ? agents[type] : undefined;
    // the call's model, else the definition's
    const model = call?.model ?? def?.model;
    if (typeof model === 'string' && /opus|fable/i.test(model))
      return pre('ask', `Subagent on ${model}: opus or higher only on the user's command.`);
    if (model === 'inherit')
      return pre('ask', "Subagent on inherit: it would run on the master's model, opus or higher only on the user's command.");
    // no model anywhere and not a preset: may be a built-in that inherits the master's model
    if (type && !def && model === undefined)
      return pre('ask', `Subagent type ${type} is not a preset: its model is unknown and may be the master's. Use reader, writer or runner.`);
  }
  if (
    MASTER_ALLOWED_TOOLS.has(input.tool_name) ||
    OWN_MCP_PREFIXES.some((p) => input.tool_name.startsWith(p))
  )
    return {};
  return pre(
    'deny',
    `The master does not use ${input.tool_name} itself: delegate it to a subagent (Agent tool) with a complete brief, and ask it for a short report.`,
  );
};

/** A pinned file above this is not injected after a compaction, only named. */
const MAX_INJECTED_BYTES = 8 * 1024;

/** What the hooks of one session need; `tasks` is live (the session manager's tracking). */
export type MasterHookContext = {
  root: string;
  /** MASTER.md and the pinned files */
  files: string[];
  tasks: () => Iterable<AgentTask>;
  agents: Record<string, AgentDefinition>;
  /** The active plan's title and its in-progress phase; null when the session has none. */
  plan?: () => Promise<{ title: string; phase?: string } | null>;
};

const mtimeOf = (root: string, rel: string) =>
  stat(resolveInSpace(root, rel)).then((s) => ({ mtime: s.mtimeMs, size: s.size }), () => undefined);

const SUPERSEDE =
  'These copies replace the copies in the system prompt, which are from session start and cannot change mid-session. The summary above may be wrong; verify against these files.';
const CALL_PLAN = 'Call mcp__plan__plan_get before continuing the task.';

/** One hooks object per session: it owns the mtimes at session start. */
export function createMasterHooks(ctx: MasterHookContext) {
  // The summary drops earlier injections and only the system-prompt copies from session start
  // remain, so every compaction compares with the session-start mtimes. Pinned files are injected
  // only then: a per-prompt injection re-sent STATE.md after each edit by the master itself
  // (5 copies in one measured session).
  const started = new Map<string, number>();
  const baseline = Promise.all(
    ctx.files.map(async (rel) => {
      const m = await mtimeOf(ctx.root, rel);
      if (m) started.set(rel, m.mtime);
    }),
  );

  // Background shell tasks share the tracking but cannot be resumed (measured: three of them
  // listed as "-" agents with 0 tokens). Only a known non-agent type is dropped.
  const roster = () =>
    [...ctx.tasks()]
      .filter((t) => !t.taskType || t.taskType === 'local_agent')
      .map((t) => `- ${t.id} | ${t.subagentType ?? '-'} | ${t.description.replace(/\s+/g, ' ').trim() || '-'} | ${t.status} | ${t.tokens} tokens`);

  /** Files that differ from session start: whole when small, a re-read line when big. */
  const changedFiles = async () => {
    await baseline;
    const small: string[] = [];
    const lines: string[] = [];
    const unchanged: string[] = [];
    for (const rel of ctx.files) {
      const m = await mtimeOf(ctx.root, rel);
      if (!m) continue;
      if (m.mtime === started.get(rel)) unchanged.push(rel);
      else if (m.size > MAX_INJECTED_BYTES) lines.push(`${rel} changed since session start; re-read it`);
      else small.push(rel);
    }
    try {
      if (small.length) lines.unshift((await buildContext(ctx.root, small)).text);
    } catch (e) {
      lines.push(`${small.join(', ')} changed but could not be read (${e instanceof Error ? e.message : String(e)}); re-read.`);
    }
    return { lines, unchanged };
  };

  // A failed lookup degrades to the bare instruction: the master reads the plan itself anyway
  const planLine = async () => {
    const plan = await ctx.plan?.().catch(() => undefined);
    if (plan === null) return 'No plan is attached; call mcp__plan__plan_get to check.';
    if (!plan) return CALL_PLAN;
    return `Active plan: "${plan.title}", ${plan.phase ? `current phase: ${plan.phase}` : 'no phase in progress'}. ${CALL_PLAN}`;
  };

  // After compaction the summary replaces the conversation: agent ids are fresh again, and so
  // are the changed files; the unchanged ones are current in the system prompt. The plan line
  // keeps the injection non-empty on purpose: the master never re-read the plan after a compaction.
  const sessionStart: HookCallback = async (input) => {
    if (input.hook_event_name !== 'SessionStart' || input.source !== 'compact') return {};
    const parts: string[] = [];
    const { lines, unchanged } = await changedFiles();
    if (lines.length) parts.push(SUPERSEDE, ...lines);
    if (unchanged.length) parts.push(`Unchanged since session start, the system-prompt copies are current: ${unchanged.join(', ')}.`);
    parts.push(await planLine());
    const rows = roster();
    if (rows.length)
      parts.push(`Subagents of this session (id | type | description | status | last context):\n${rows.join('\n')}`);
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: parts.join('\n\n') } };
  };

  return {
    PreToolUse: [{ hooks: [createMasterPreToolUse(ctx.agents)] }],
    SessionStart: [{ matcher: 'compact', hooks: [sessionStart] }],
  } satisfies Record<string, HookCallbackMatcher[]>;
}
