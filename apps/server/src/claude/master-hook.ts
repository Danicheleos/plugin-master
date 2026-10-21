import type { HookCallback, HookCallbackMatcher, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';

/**
 * Allow-list of the master's own tools: planning, delegation, asking the user, and reading/small
 * edits of files (the prompt asks it to delegate anything larger). Everything else (shell, web,
 * notebook, MCP resources and tools of the project's `.mcp.json`, tools loaded by ToolSearch) is
 * denied, so a tool missing from a deny list cannot leak access.
 */
const MASTER_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'Agent', 'Task', 'TaskOutput', 'TaskStop', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate',
  'Read', 'Glob', 'Grep', 'Edit', 'Write',
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
export const masterPreToolUse: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PreToolUse') return {};
  // costs money: asks for subagents too (auto/dontAsk must not approve it)
  if (ALWAYS_ASK_TOOLS.has(input.tool_name))
    return pre('ask', 'Eval runs cost money: the user must confirm.');
  if (input.agent_id) return {};
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

export const MASTER_HOOKS: { PreToolUse: HookCallbackMatcher[] } = {
  PreToolUse: [{ hooks: [masterPreToolUse] }],
};
