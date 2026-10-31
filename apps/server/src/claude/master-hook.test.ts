import { describe, expect, it } from 'vitest';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { MASTER_HOOKS, masterPreToolUse } from './master-hook';

const run = (tool_name: string, extra: Record<string, unknown> = {}) =>
  masterPreToolUse(
    {
      hook_event_name: 'PreToolUse',
      session_id: 's',
      transcript_path: '',
      cwd: '/',
      tool_name,
      tool_input: {},
      tool_use_id: 't',
      ...extra,
    } as HookInput,
    't',
    { signal: new AbortController().signal },
  );

describe('masterPreToolUse', () => {
  it.each(['Bash', 'NotebookEdit', 'WebFetch', 'WebSearch', 'BashOutput', 'NotebookRead', 'TodoRead', 'ReadMcpResourceTool', 'mcp__fs__read_file', 'SomeFutureTool'])(
    'denies %s for the master',
    async (tool) => {
      expect(await run(tool)).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: expect.stringContaining(
            `The master does not use ${tool} itself: delegate it to a subagent (Agent tool)`,
          ),
        },
      });
    },
  );

  it('lets subagent calls through', async () => {
    for (const t of ['Read', 'Edit', 'Bash'])
      expect(await run(t, { agent_id: 'a1', agent_type: 'general-purpose' })).toEqual({});
  });

  it('asks for eval_run from a subagent too', async () => {
    const r = await run('mcp__evals__eval_run', { agent_id: 'a1' });
    expect(r).toMatchObject({ hookSpecificOutput: { permissionDecision: 'ask' } });
  });

  it.each([
    'Agent', 'Task', 'Read', 'Glob', 'Grep', 'Edit', 'Write', 'TodoWrite', 'ToolSearch', 'AskUserQuestion', 'ExitPlanMode', 'Skill',
    'mcp__plan__plan_get', 'mcp__plan__phase_start', 'mcp__evals__eval_status',
  ])('allows %s', async (tool) => {
    expect(await run(tool)).toEqual({});
  });

  it('asks for eval_run, also in auto mode', async () => {
    const r = await run('mcp__evals__eval_run', { permission_mode: 'auto' });
    expect(r).toMatchObject({ hookSpecificOutput: { permissionDecision: 'ask' } });
  });

  describe('subagent model', () => {
    const agent = (tool: string, model?: string, extra: Record<string, unknown> = {}) =>
      run(tool, { tool_input: { description: 'd', prompt: 'p', ...(model ? { model } : {}) }, ...extra });

    it.each(['Agent', 'Task'])('asks for %s on opus', async (tool) => {
      expect(await agent(tool, 'opus')).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: "Subagent on opus: opus or higher only on the user's command.",
        },
      });
    });

    it('asks for a fable model id', async () => {
      const r = await agent('Agent', 'claude-fable-5-1');
      expect(r).toMatchObject({ hookSpecificOutput: { permissionDecision: 'ask' } });
    });

    it.each([['sonnet'], ['haiku'], [undefined]])('allows model %s', async (model) => {
      expect(await agent('Agent', model)).toEqual({});
    });

    it('passes a subagent call through unchanged', async () => {
      expect(await agent('Agent', 'opus', { agent_id: 'a1' })).toEqual({});
    });
  });

  it('is registered for every tool', () => {
    expect(MASTER_HOOKS.PreToolUse).toEqual([{ hooks: [masterPreToolUse] }]);
  });
});
