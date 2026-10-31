import { describe, expect, it } from 'vitest';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentTask } from '@pm/protocol';
import { createMasterHooks, createMasterPreToolUse } from './master-hook';

const agents = {
  deep: { description: 'd', prompt: 'p', model: 'opus' },
  fast: { description: 'd', prompt: 'p', model: 'claude-sonnet-5-5' },
};
const masterPreToolUse = createMasterPreToolUse(agents);

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
    'Agent', 'Task', 'Read', 'Glob', 'Grep', 'Edit', 'Write', 'ListAgents', 'TodoWrite', 'ToolSearch', 'AskUserQuestion', 'ExitPlanMode', 'Skill',
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

    it('asks for a subagent_type whose definition is on opus, passes a sonnet one', async () => {
      const typed = (subagent_type: string, model?: string) =>
        run('Agent', { tool_input: { description: 'd', prompt: 'p', subagent_type, ...(model && { model }) } });
      expect(await typed('deep')).toMatchObject({ hookSpecificOutput: { permissionDecision: 'ask' } });
      expect(await typed('fast')).toEqual({});
      expect(await typed('unknown')).toMatchObject({ hookSpecificOutput: { permissionDecision: 'ask' } });
      expect(await typed('unknown', 'haiku')).toEqual({}); // an explicit model wins
      expect(await typed('deep', 'haiku')).toEqual({}); // the call's own model wins
    });

    it('asks for model inherit, per call or by definition', async () => {
      const a = createMasterPreToolUse({ ...agents, same: { description: 'd', prompt: 'p', model: 'inherit' } });
      const call = (tool_input: object) =>
        a({ hook_event_name: 'PreToolUse', session_id: 's', transcript_path: '', cwd: '/', tool_name: 'Agent', tool_input, tool_use_id: 't' } as HookInput, 't', { signal: new AbortController().signal });
      expect(await call({ model: 'inherit' })).toMatchObject({ hookSpecificOutput: { permissionDecision: 'ask' } });
      expect(await call({ subagent_type: 'same' })).toMatchObject({ hookSpecificOutput: { permissionDecision: 'ask' } });
    });

    it('asks for a subagent_type that is not in the presets (it may inherit)', async () => {
      const r = await run('Agent', { tool_input: { description: 'd', prompt: 'p', subagent_type: 'statusline-setup' } });
      expect(r).toMatchObject({ hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: expect.stringContaining('statusline-setup') } });
    });

    it('allows an overridden built-in and a call without subagent_type or model', async () => {
      const a = createMasterPreToolUse({ Explore: { description: 'd', prompt: 'p', model: 'haiku' } });
      const call = (tool_input: object) =>
        a({ hook_event_name: 'PreToolUse', session_id: 's', transcript_path: '', cwd: '/', tool_name: 'Agent', tool_input, tool_use_id: 't' } as HookInput, 't', { signal: new AbortController().signal });
      expect(await call({ subagent_type: 'Explore' })).toEqual({});
      expect(await call({ description: 'd', prompt: 'p' })).toEqual({});
    });

    it('passes a subagent call through unchanged', async () => {
      expect(await agent('Agent', 'opus', { agent_id: 'a1' })).toEqual({});
    });
  });

  it('registers PreToolUse for every tool, SessionStart on compact and UserPromptSubmit', () => {
    const h = createMasterHooks({ root: '/', files: [], tasks: () => [], agents });
    expect(h.PreToolUse).toHaveLength(1);
    expect(h.SessionStart[0]?.matcher).toBe('compact');
    expect(h.UserPromptSubmit).toHaveLength(1);
  });
});

describe('context hooks', () => {
  const opt = { signal: new AbortController().signal };
  async function setup(files: Record<string, string>, tasks: AgentTask[] = []) {
    const root = await mkdtemp(join(tmpdir(), 'pm-hook-'));
    await mkdir(join(root, '.plugin-master'));
    for (const [f, c] of Object.entries(files)) await writeFile(join(root, f), c);
    const h = createMasterHooks({ root, files: Object.keys(files), tasks: () => tasks, agents });
    const base = { session_id: 's', transcript_path: '', cwd: root };
    const start = (source: string) =>
      h.SessionStart[0]!.hooks[0]!({ ...base, hook_event_name: 'SessionStart', source } as HookInput, 't', opt);
    const prompt = () =>
      h.UserPromptSubmit[0]!.hooks[0]!({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'x' } as HookInput, 't', opt);
    return { root, start, prompt };
  }
  const ctx = (r: unknown) => (r as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext;
  const bump = (root: string, f: string) => utimes(join(root, f), new Date(), new Date(Date.now() + 5000));

  const UNCHANGED = (paths: string) => `Unchanged since session start, the system-prompt copies are current: ${paths}.`;
  const agent1: AgentTask = { id: 'ag1', description: 'check logs', subagentType: 'reader', status: 'running', tokens: 1234, toolUses: 2 };

  it('compact with nothing changed: only the unchanged-files line and the roster, no file bodies', async () => {
    const { start } = await setup({ 'a.md': 'one', 'b.md': 'two' }, [agent1]);
    const out = ctx(await start('compact'));
    expect(out).not.toContain('<file');
    expect(out).not.toContain('plugin-master context');
    expect(out).toContain(UNCHANGED('a.md, b.md'));
    expect(out).toContain('- ag1 | reader | check logs | running | 1234 tokens');
  });

  it('compact with nothing changed and no roster returns {}', async () => {
    const { start } = await setup({ 'a.md': 'one' });
    expect(await start('compact')).toEqual({});
  });

  it('compact injects a file changed before the compaction and names the others as unchanged', async () => {
    const { root, start } = await setup({ 'a.md': 'old text', 'b.md': 'two' }, [agent1]);
    await writeFile(join(root, 'a.md'), 'NEW text');
    await bump(root, 'a.md');
    const out = ctx(await start('compact'));
    expect(out).toContain('<file path="a.md">\nNEW text\n</file>');
    expect(out).not.toContain('<file path="b.md">');
    expect(out).toContain(UNCHANGED('b.md'));
    expect(out).toContain('- ag1 | reader');
  });

  it('compact injects again a file that UserPromptSubmit injected before the compaction', async () => {
    const { root, start, prompt } = await setup({ 'a.md': 'one', 'b.md': 'two' });
    await writeFile(join(root, 'a.md'), 'ONE changed');
    await bump(root, 'a.md');
    expect(ctx(await prompt())).toContain('ONE changed');
    expect(await prompt()).toEqual({});
    const out = ctx(await start('compact'));
    expect(out).toContain('<file path="a.md">\nONE changed\n</file>');
    expect(out).toContain(UNCHANGED('b.md'));
  });

  it('compact names a changed file over 8 KB instead of injecting it', async () => {
    const { root, start } = await setup({ 'big.md': 'x', 'b.md': 'two' });
    await writeFile(join(root, 'big.md'), 'y'.repeat(9000));
    await bump(root, 'big.md');
    const out = ctx(await start('compact'));
    expect(out).toContain('big.md changed since session start; re-read it');
    expect(out).not.toContain('<file');
    expect(out).toContain(UNCHANGED('b.md'));
  });

  it('after a compaction UserPromptSubmit does not re-inject a file the compaction already injected', async () => {
    const { root, start, prompt } = await setup({ 'a.md': 'one', 'b.md': 'two' });
    await writeFile(join(root, 'a.md'), 'ONE changed');
    await bump(root, 'a.md');
    expect(ctx(await start('compact'))).toContain('ONE changed');
    expect(await prompt()).toEqual({});
  });

  it('compact SessionStart gives only the roster without pinned files, nothing for other sources', async () => {
    const { start } = await setup({}, [{ id: 'ag1', description: 'd', status: 'completed', tokens: 5, toolUses: 1 }]);
    const out = ctx(await start('compact'));
    expect(out).toContain('ag1');
    expect(out).not.toContain('<file');
    expect(await start('startup')).toEqual({});
  });

  it('UserPromptSubmit injects a changed file once, and nothing when unchanged', async () => {
    const { root, prompt } = await setup({ 'a.md': 'one', 'b.md': 'two' });
    expect(await prompt()).toEqual({});
    await writeFile(join(root, 'a.md'), 'ONE changed');
    await bump(root, 'a.md');
    const out = ctx(await prompt());
    expect(out).toContain('<file path="a.md">\nONE changed\n</file>');
    expect(out).not.toContain('b.md');
    expect(await prompt()).toEqual({});
  });

  it('UserPromptSubmit names a changed file over 8 KB instead of injecting it', async () => {
    const { root, prompt } = await setup({ 'big.md': 'x' });
    await writeFile(join(root, 'big.md'), 'y'.repeat(9000));
    await bump(root, 'big.md');
    const out = ctx(await prompt());
    expect(out).toBe('big.md changed since session start; re-read it');
  });

  it('after a compact injection the next prompt does not inject the same change again', async () => {
    const { root, start, prompt } = await setup({ 'a.md': 'one' });
    await writeFile(join(root, 'a.md'), 'two');
    await bump(root, 'a.md');
    expect(ctx(await start('compact'))).toContain('two');
    expect(await prompt()).toEqual({});
  });

  it('names an unreadable changed file instead of throwing, in both hooks', async () => {
    const { root, start, prompt } = await setup({ 'bin.md': 'x', 'ok.md': 'y' });
    await writeFile(join(root, 'bin.md'), 'a\0b');
    await bump(root, 'bin.md');
    expect(ctx(await start('compact'))).toContain('bin.md changed but could not be read');
    await writeFile(join(root, 'bin.md'), 'c\0d');
    await utimes(join(root, 'bin.md'), new Date(), new Date(Date.now() + 9000));
    expect(ctx(await prompt())).toContain('bin.md changed but could not be read');
  });

  it('puts a description on one line in the roster', async () => {
    const { start } = await setup({}, [{ id: 'a', description: 'line one\n\n  line   two', status: 'running', tokens: 1, toolUses: 0 }]);
    expect(ctx(await start('compact'))).toContain('| line one line two | running |');
  });
});
