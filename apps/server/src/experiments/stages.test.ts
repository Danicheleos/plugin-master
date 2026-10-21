import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AnalysisSchema, ExecutionSummarySchema, HypothesisSchema } from '@pm/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recorder } from '../runs/recorder';
import { runStage, stageJsonSchema, stagePolicy, StageError, type StageQuery } from './stages';

let tmp: string;
let wt: string;
beforeEach(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), 'pm-stage-')));
  wt = join(tmp, 'wt');
  await mkdir(join(wt, '.git'), { recursive: true });
  await mkdir(join(tmp, 'outside'));
  await symlink(join(tmp, 'outside'), join(wt, 'link'));
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

const signal = new AbortController().signal;
const ask = (policy: ReturnType<typeof stagePolicy>, tool: string, input: Record<string, unknown>) =>
  policy(tool, input, { signal } as never) as Promise<{ behavior: string; message?: string }>;

describe('policy', () => {
  it('master and analyst: only reads, everything else is denied without asking', async () => {
    const onPermission = vi.fn(async () => true);
    for (const role of ['master', 'analyst'] as const) {
      const pol = stagePolicy({ role, cwd: wt, onPermission });
      expect((await ask(pol, 'Read', { file_path: 'a.md' })).behavior).toBe('allow');
      expect((await ask(pol, 'Grep', { pattern: 'x' })).behavior).toBe('allow');
      expect(await ask(pol, 'Write', { file_path: 'a.md' })).toMatchObject({ behavior: 'deny', message: 'read-only stage' });
      expect((await ask(pol, 'Bash', { command: 'ls' })).behavior).toBe('deny');
      expect((await ask(pol, 'Read', { file_path: '/etc/passwd' })).behavior).toBe('deny');
    }
    expect(onPermission).not.toHaveBeenCalled();
  });

  it('analyst can read additional directories', async () => {
    const pol = stagePolicy({ role: 'analyst', cwd: wt, additionalDirectories: [join(tmp, 'outside')] });
    expect((await ask(pol, 'Read', { file_path: join(tmp, 'outside', 'r.json') })).behavior).toBe('allow');
  });

  it('executor: edits only inside the worktree and outside .git', async () => {
    const pol = stagePolicy({ role: 'executor', cwd: wt });
    await writeFile(join(wt, 'a.txt'), '');
    expect((await ask(pol, 'Edit', { file_path: join(wt, 'a.txt') })).behavior).toBe('allow');
    expect((await ask(pol, 'Write', { file_path: 'new/dir/b.txt' })).behavior).toBe('allow');
    expect((await ask(pol, 'NotebookEdit', { notebook_path: 'n.ipynb' })).behavior).toBe('allow');
    expect((await ask(pol, 'Write', { file_path: '../x' })).behavior).toBe('deny');
    expect((await ask(pol, 'Write', { file_path: join(tmp, 'x') })).behavior).toBe('deny');
    expect((await ask(pol, 'Write', { file_path: 'link/x' })).behavior).toBe('deny');
    expect((await ask(pol, 'Write', { file_path: '.git/config' })).behavior).toBe('deny');
    expect((await ask(pol, 'Write', { file_path: '.GIT/config' })).behavior).toBe('deny');
    expect((await ask(pol, 'Write', { file_path: '.plugin-master/config.json' })).behavior).toBe('deny');
    expect((await ask(pol, 'Edit', { file_path: 'a\0b' })).behavior).toBe('deny');
    expect((await ask(pol, 'Edit', {})).behavior).toBe('deny');
  });

  it('executor: the allowed path is passed on as the checked absolute path (no `~` expansion by the tool)', async () => {
    const pol = stagePolicy({ role: 'executor', cwd: wt });
    expect(await ask(pol, 'Write', { file_path: '~/.bashrc', content: 'x' })).toEqual({
      behavior: 'allow',
      updatedInput: { file_path: join(wt, '~/.bashrc'), content: 'x' },
    });
  });

  it('executor: other tools go to onPermission, default deny', async () => {
    expect((await ask(stagePolicy({ role: 'executor', cwd: wt }), 'Bash', { command: 'ls' })).behavior).toBe('deny');
    const onPermission = vi.fn(async () => true);
    const pol = stagePolicy({ role: 'executor', cwd: wt, onPermission });
    expect((await ask(pol, 'Bash', { command: 'ls' })).behavior).toBe('allow');
    expect(onPermission).toHaveBeenCalledWith({ toolName: 'Bash', input: { command: 'ls' }, signal });
    const no = stagePolicy({ role: 'executor', cwd: wt, onPermission: async () => false });
    expect((await ask(no, 'WebFetch', {})).behavior).toBe('deny');
  });

  it('executor: edits that can run code or change the eval need approval', async () => {
    const risky = [
      'hooks/hooks.json', '.mcp.json', 'skills/s/scripts/run.txt', 'x.sh', 'a/b.MJS',
      '.claude/settings.json', '.claude-plugin/plugin.json', 'evals/c/prompt.md',
    ];
    const plain = stagePolicy({ role: 'executor', cwd: wt });
    for (const f of risky) expect((await ask(plain, 'Write', { file_path: f })).behavior, f).toBe('deny');
    const onPermission = vi.fn(async () => true);
    const pol = stagePolicy({ role: 'executor', cwd: wt, onPermission });
    for (const f of risky) {
      const input = { file_path: join(wt, f), content: 'x' };
      expect(await ask(pol, 'Write', { file_path: f, content: 'x' }), f).toEqual({ behavior: 'allow', updatedInput: input });
      expect(onPermission).toHaveBeenLastCalledWith({ toolName: 'Write', input, signal });
    }
    onPermission.mockClear();
    expect((await ask(pol, 'Edit', { file_path: 'skills/s/SKILL.md' })).behavior).toBe('allow');
    expect(onPermission).not.toHaveBeenCalled();
  });
  it('a symlinked cwd: paths under the symlink and under its realpath are both inside', async () => {
    const via = join(tmp, 'via');
    await symlink(wt, via);
    await symlink(join(tmp, 'outside'), join(tmp, 'via-out'));
    await writeFile(join(wt, 'a.txt'), '');
    const onPermission = vi.fn(async () => true);
    const pol = stagePolicy({ role: 'executor', cwd: via, onPermission, additionalDirectories: [join(tmp, 'via-out')] });
    for (const base of [wt, via]) {
      expect(await ask(pol, 'Edit', { file_path: join(base, 'a.txt') })).toEqual({
        behavior: 'allow',
        updatedInput: { file_path: join(wt, 'a.txt') },
      });
      expect((await ask(pol, 'Write', { file_path: join(base, '.git/config') })).behavior).toBe('deny');
      expect((await ask(pol, 'Write', { file_path: join(base, 'link/x') })).behavior).toBe('deny');
      expect((await ask(pol, 'Write', { file_path: join(base, '../x') })).behavior).toBe('deny');
      expect((await ask(pol, 'Read', { file_path: join(base, 'a.txt') })).behavior).toBe('allow');
      expect((await ask(pol, 'Read', { file_path: join(base, '../x') })).behavior).toBe('deny');
    }
    expect((await ask(pol, 'Edit', { file_path: 'a.txt' })).behavior).toBe('allow');
    expect((await ask(pol, 'Read', { file_path: join(tmp, 'outside', 'r.json') })).behavior).toBe('allow');
    expect((await ask(pol, 'Read', { file_path: join(tmp, 'via-out', 'r.json') })).behavior).toBe('allow');
    expect((await ask(pol, 'Write', { file_path: join(tmp, 'outside', 'r.json') })).behavior).toBe('deny');
    expect((await ask(pol, 'Read', { file_path: '/etc/passwd' })).behavior).toBe('deny');
    expect(onPermission).not.toHaveBeenCalled();
  });
});

describe('runStage', () => {
  const hyp = { title: 't', rationale: 'r', expectedEffect: [{ case: 'c', effect: 'up' }], files: ['a'] };
  const result = (o: object) => ({ type: 'result', subtype: 'success', session_id: 's1', total_cost_usd: 0.5, num_turns: 3, ...o }) as unknown as SDKMessage;
  const recorder = () => {
    const w = { user: vi.fn(), message: vi.fn() };
    return { rec: { start: vi.fn(() => w) } as unknown as Recorder, w };
  };
  const run = (queryFn: StageQuery, extra: object = {}) => {
    const r = recorder();
    const p = runStage({ role: 'master', cwd: wt, spaceRoot: tmp, prompt: 'go', schema: HypothesisSchema, recorder: r.rec, queryFn, ...extra });
    return { p, r };
  };
  const fake = (...ms: object[]): StageQuery => async function* () { yield* ms as SDKMessage[]; };

  it('parses structured output, records under the space root, passes options', async () => {
    let opts: Record<string, unknown> = {};
    const { p, r } = run(async function* (a) {
      opts = a.options as never;
      yield { type: 'system', subtype: 'init', session_id: 's1' } as SDKMessage;
      yield result({ structured_output: hyp });
    });
    expect(await p).toEqual({ result: hyp, sessionId: 's1', costUsd: 0.5, turns: 3 });
    expect((r.rec.start as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([tmp]);
    expect(r.w.user).toHaveBeenCalledWith('go');
    expect(r.w.message).toHaveBeenCalledTimes(2);
    expect(opts).toMatchObject({ cwd: wt, permissionMode: 'default', settingSources: [], outputFormat: { type: 'json_schema' } });
    expect(opts.disallowedTools).toEqual(expect.arrayContaining(['Task', 'Agent', 'Bash', 'Write']));
    const schema = (opts.outputFormat as { schema: Record<string, unknown> }).schema;
    expect(schema).not.toHaveProperty('$schema');
    expect(schema).toMatchObject({ type: 'object', required: expect.arrayContaining(['title']) });
  });

  it('stage schemas carry no draft 2020-12 meta-schema or keywords (the CLI validator rejects them)', () => {
    for (const s of [HypothesisSchema, ExecutionSummarySchema, AnalysisSchema]) {
      const json = JSON.stringify(stageJsonSchema(s));
      expect(json).not.toMatch(/\$schema|2020-12|prefixItems|\$defs|unevaluated|dependentSchemas/);
    }
  });

  it('passes the budget cap; a failed result carries its cost', async () => {
    let opts: Record<string, unknown> = {};
    const { p } = run(async function* (a) {
      opts = a.options as never;
      yield result({ subtype: 'error_max_budget_usd', total_cost_usd: 0.7 });
    }, { maxBudgetUsd: 0.6 });
    await expect(p).rejects.toMatchObject({ code: 'SDK_ERROR', costUsd: 0.7 });
    expect(opts.maxBudgetUsd).toBe(0.6);
  });

  it('invalid, missing output and SDK errors are typed', async () => {
    await expect(run(fake(result({ structured_output: { title: 1 } }))).p).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
    await expect(run(fake(result({}))).p).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
    await expect(run(fake(result({ subtype: 'error_max_turns' }))).p).rejects.toMatchObject({ code: 'SDK_ERROR' });
    await expect(run(fake()).p).rejects.toMatchObject({ code: 'SDK_ERROR' });
    await expect(run(() => { throw new Error('boom'); }).p).rejects.toThrow('boom');
  });

  it('abort via signal', async () => {
    const ac = new AbortController();
    let aborted = false;
    const { p } = run((a) => {
      (a.options.abortController as AbortController).signal.addEventListener('abort', () => (aborted = true));
      ac.abort();
      throw new Error('killed');
    }, { signal: ac.signal });
    await expect(p).rejects.toBeInstanceOf(StageError);
    await expect(p).rejects.toMatchObject({ code: 'ABORTED' });
    expect(aborted).toBe(true);
    await expect(run(fake(), { signal: ac.signal }).p).rejects.toMatchObject({ code: 'ABORTED' });
  });
});
