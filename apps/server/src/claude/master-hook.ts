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
  // opus or higher for a subagent only on the user's command; the prompt alone did not hold it
  const call = input.tool_input as { model?: unknown; subagent_type?: unknown } | null;
  // without a `model` param the agent definition's model applies
  const model = call?.model ?? (typeof call?.subagent_type === 'string' ? agents[call.subagent_type]?.model : undefined);
  if ((input.tool_name === 'Agent' || input.tool_name === 'Task') && typeof model === 'string' && /opus|fable/i.test(model))
    return pre('ask', `Subagent on ${model}: opus or higher only on the user's command.`);
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

/** A pinned file above this is not re-injected on change, only named. */
const MAX_INJECTED_BYTES = 8 * 1024;

/** What the hooks of one session need; `tasks` is live (the session manager's tracking). */
export type MasterHookContext = {
  root: string;
  /** MASTER.md and the pinned files */
  files: string[];
  tasks: () => Iterable<AgentTask>;
  agents: Record<string, AgentDefinition>;
};

const mtimeOf = (root: string, rel: string) =>
  stat(resolveInSpace(root, rel)).then((s) => ({ mtime: s.mtimeMs, size: s.size }), () => undefined);

const extra = (hookEventName: 'SessionStart' | 'UserPromptSubmit', additionalContext: string): HookJSONOutput => ({
  hookSpecificOutput: { hookEventName, additionalContext },
});

/** One hooks object per session: it owns the mtimes seen at the last injection. */
export function createMasterHooks(ctx: MasterHookContext) {
  const seen = new Map<string, number>();
  const note = async (rel: string) => {
    const m = await mtimeOf(ctx.root, rel);
    if (m) seen.set(rel, m.mtime);
    return m;
  };
  const baseline = Promise.all(ctx.files.map(note));

  const roster = () =>
    [...ctx.tasks()].map(
      (t) => `- ${t.id} | ${t.subagentType ?? '-'} | ${t.description || '-'} | ${t.status} | ${t.tokens} tokens`,
    );

  // After compaction the summary replaces the conversation: files and agent ids are fresh again
  const sessionStart: HookCallback = async (input) => {
    if (input.hook_event_name !== 'SessionStart' || input.source !== 'compact') return {};
    const parts: string[] = [];
    if (ctx.files.length) {
      try {
        const { text } = await buildContext(ctx.root, ctx.files);
        parts.push(text, 'These are the current files; the copies in the system prompt are from session start.');
        await Promise.all(ctx.files.map(note));
      } catch (e) {
        parts.push(`The pinned files could not be re-read (${e instanceof Error ? e.message : String(e)}); read them again yourself.`);
      }
    }
    const lines = roster();
    if (lines.length)
      parts.push(`Subagents of this session (id | type | description | status | last context):\n${lines.join('\n')}`);
    return parts.length ? extra('SessionStart', parts.join('\n\n')) : {};
  };

  const userPromptSubmit: HookCallback = async (input) => {
    if (input.hook_event_name !== 'UserPromptSubmit') return {};
    await baseline;
    const small: string[] = [];
    const lines: string[] = [];
    for (const rel of ctx.files) {
      const before = seen.get(rel);
      const m = await note(rel);
      if (!m || m.mtime === before) continue;
      if (m.size > MAX_INJECTED_BYTES) lines.push(`${rel} changed since session start; re-read it`);
      else small.push(rel);
    }
    try {
      if (small.length) lines.unshift((await buildContext(ctx.root, small)).text);
    } catch (e) {
      lines.push(`${small.join(', ')} changed but could not be read (${e instanceof Error ? e.message : String(e)}); re-read.`);
    }
    return lines.length ? extra('UserPromptSubmit', lines.join('\n\n')) : {};
  };

  return {
    PreToolUse: [{ hooks: [createMasterPreToolUse(ctx.agents)] }],
    SessionStart: [{ matcher: 'compact', hooks: [sessionStart] }],
    UserPromptSubmit: [{ hooks: [userPromptSubmit] }],
  } satisfies Record<string, HookCallbackMatcher[]>;
}
