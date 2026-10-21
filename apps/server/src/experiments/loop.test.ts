import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ServerMessage, StageRole } from '@pm/protocol';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPermissions } from '../claude/permissions';
import { evalsRoutes } from '../evals/routes';
import { createEvalRunner, type EvalProcess } from '../evals/runner';
import type { AppError } from '../lib/errors';
import type { Recorder } from '../runs/recorder';
import { createRegistry } from '../spaces/registry';
import { readLedger } from './ledger';
import { createExperimentLoop, INTERRUPTED } from './loop';
import { experimentsRoutes } from './routes';
import { getExperiment, listExperiments, lockedExp, saveExperiment } from './store';
import type { StageQuery } from './stages';
import { worktreesDir } from './worktree';

Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });
const resultJson = (startedAt: string, scores: Record<string, number>) =>
  JSON.stringify({
    schemaVersion: 1,
    startedAt,
    durationSeconds: 1,
    costUsd: 0.3,
    suite: { ablation: 'none', plugins: [{ name: 'p' }] },
    cases: Object.entries(scores).map(([name, score]) => ({
      name,
      arms: {
        with: [
          {
            score,
            passed: score >= 1,
            graders:
              score < 1
                ? [{ name: 'g', passed: false, explanation: 'missing X' }]
                : [],
          },
        ],
        without: [],
      },
      aggregates: { score },
    })),
    aggregates: {},
  });

class FakeProc extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => void this.emit('close', 130));
}

let tmp: string;
let root: string;
let home: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pm-loop-'));
  root = join(tmp, 'plug');
  home = join(tmp, 'home');
  await mkdir(join(root, 'skills/s'), { recursive: true });
  await mkdir(join(root, '.plugin-master'));
  await writeFile(
    join(root, '.plugin-master/config.json'),
    JSON.stringify({
      masterContext: [],
      evalTrusted: true,
      features: { git: true, masterLoop: true },
    }),
  );
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'user.email', 't@t');
  await writeFile(
    join(root, '.gitignore'),
    '.plugin-master/\nevals/results/\n',
  );
  await writeFile(join(root, 'skills/s/SKILL.md'), 'skill\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'first');
  // an earlier eval of the space (the baseline)
  await mkdir(join(root, 'evals/results/base1'), { recursive: true });
  await writeFile(
    join(root, 'evals/results/base1/aggregate-result.json'),
    resultJson('2026-01-01T00:00:00.000Z', { c1: 0.5, c2: 1 }),
  );
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

type Behave = {
  hang?: StageRole;
  noChange?: boolean;
  cost?: number;
  ask?: boolean;
  fail?: StageRole;
  /** the SDK reports error_max_budget_usd after spending 0.4 */
  failResult?: StageRole;
  evalHangs?: boolean;
  /** the executor rewrites SKILL.md with this text instead of appending a line */
  skill?: string;
};

async function setup(b: Behave = {}) {
  const msgs: ServerMessage[] = [];
  const broadcast = (_id: string, m: ServerMessage) => void msgs.push(m);
  const seen: string[] = [];
  const decisions: string[] = [];
  const procs: FakeProc[] = [];
  const spawner = vi.fn((_c: string, args: string[], _o: object) => {
    const p = new FakeProc();
    procs.push(p);
    if (!b.evalHangs)
      setTimeout(async () => {
        const out = args[args.indexOf('--output-dir') + 1]!;
        await mkdir(out, { recursive: true });
        await writeFile(
          join(out, 'aggregate-result.json'),
          resultJson(new Date().toISOString(), { c1: 1, c2: 1 }),
        );
        p.emit('close', 0);
      }, 5);
    return p as unknown as EvalProcess;
  });
  const evalRunner = createEvalRunner(
    { broadcast, onSubscribe: () => undefined },
    spawner,
  );
  const permissions = createPermissions(broadcast);
  const stageOptions: Options[] = [];
  const prompts: Record<string, string> = {};
  const queryFn: StageQuery = async function* ({ prompt, options }) {
    stageOptions.push(options);
    const append = (options.systemPrompt as { append: string }).append;
    const role: StageRole = append.includes('Role: master')
      ? 'master'
      : append.includes('Role: executor')
        ? 'executor'
        : 'analyst';
    prompts[role] = String(prompt);
    const rec = await getExperiment(root, 1).catch(() => null);
    seen.push(`${role}:${rec?.stage}:${rec?.status}`);
    const signal = options.abortController!.signal;
    if (b.hang === role) {
      // the cancel may already have happened while this fake awaited above
      await new Promise<void>((r) =>
        signal.aborted ? r() : signal.addEventListener('abort', () => r()),
      );
      throw new Error('killed');
    }
    if (b.fail === role) throw new Error('sdk boom');
    if (b.failResult === role) {
      yield { type: 'result', subtype: 'error_max_budget_usd', session_id: 's', total_cost_usd: 0.4 } as unknown as SDKMessage;
      return;
    }
    if (role === 'executor') {
      if (b.skill !== undefined)
        await writeFile(join(options.cwd!, 'skills/s/SKILL.md'), b.skill);
      else if (!b.noChange)
        await appendFile(join(options.cwd!, 'skills/s/SKILL.md'), 'more\n');
      if (b.ask)
        decisions.push(
          (await options.canUseTool!('Bash', { command: 'ls' }, {
            signal,
          } as never))!.behavior,
        );
    }
    const out = {
      master: {
        title: 'Tighten s',
        rationale: 'because',
        expectedEffect: [{ case: 'c1', effect: 'up' }],
        files: ['skills/s/SKILL.md'],
      },
      executor: { summary: 'did it', filesChanged: ['skills/s/SKILL.md'] },
      analyst: {
        verdict: 'improve',
        reasons: ['c1 went up'],
        cases: [{ case: 'c1', note: 'fixed' }],
        recommendation: 'merge',
        lesson: 'c1 needs explicit wording',
      },
    }[role];
    yield {
      type: 'result',
      subtype: 'success',
      session_id: `s-${role}`,
      total_cost_usd: b.cost ?? 0.1,
      num_turns: 1,
      structured_output: out,
    } as unknown as SDKMessage;
  };
  const recorder = {
    start: () => ({ user: () => undefined, message: () => undefined }),
  } as unknown as Recorder;
  const onError = vi.fn();
  const loop = createExperimentLoop({
    evalRunner,
    permissions,
    recorder,
    queryFn,
    onError,
    onChange: () =>
      broadcast('s1', { type: 'experiments.changed', spaceId: 's1' }),
  });
  const registry = createRegistry(home);
  await registry.add({ id: 's1', name: 'p', path: root, createdAt: '' });
  const app = Fastify();
  app.setErrorHandler((e: AppError, _r, reply) =>
    reply.code(e.status ?? 400).send({ error: { code: e.code } }),
  );
  const routeChange = vi.fn();
  await app.register(experimentsRoutes(registry, home, routeChange, loop));
  await app.register(evalsRoutes(registry, evalRunner, loop.busy));
  const post = (url: string, payload?: object) =>
    app.inject({
      method: 'POST',
      url: `/spaces/s1/experiments${url}`,
      payload,
    });
  const ctx = { root, dir: worktreesDir(home, 's1') };
  const status = async () => (await getExperiment(root, 1)).status;
  const waitStatus = (s: string) =>
    vi.waitFor(async () => expect(await status()).toBe(s), { timeout: 5000 });
  return {
    loop,
    evalRunner,
    permissions,
    post,
    ctx,
    msgs,
    seen,
    decisions,
    procs,
    spawner,
    onError,
    status,
    waitStatus,
    app,
    stageOptions,
    prompts,
    routeChange,
  };
}

describe('happy path', () => {
  it('runs all stages, persists them and proposes; merge writes STATE and DECISIONS', async () => {
    const t = await setup({ ask: true });
    const res = await t.post('/run', {
      maxCostUsd: 5,
      focus: 'c1 fails',
      cases: ['c1', 'c2'],
    });
    expect(res.json()).toMatchObject({
      id: 1,
      status: 'running',
      maxCostUsd: 5,
      focus: 'c1 fails',
    });
    // the executor's Bash goes to the hub with a distinct id; a reply resolves it
    await vi.waitFor(
      () => expect(t.permissions.pendingFor('s1')).toHaveLength(1),
      { timeout: 5000 },
    );
    const req = t.permissions.pendingFor('s1')[0] as Extract<
      ServerMessage,
      { type: 'permission.request' }
    >;
    expect(req.requestId).toMatch(/^exp-1-/);
    expect(req.toolName).toBe('Experiment 1 executor: Bash');
    expect(t.msgs).toContainEqual(req);
    t.permissions.reply(req.requestId, true);
    await t.waitStatus('ready');
    expect(t.decisions).toEqual(['allow']);
    expect(t.permissions.pendingFor('s1')).toEqual([]);

    const e = await getExperiment(root, 1);
    expect(t.seen).toEqual([
      'master:hypothesis:running',
      'executor:execute:running',
      'analyst:analyze:running',
    ]);
    expect(e).toMatchObject({
      stage: 'proposal',
      hypothesis: 'Tighten s',
      plan: { title: 'Tighten s' },
      execution: { summary: 'did it' },
      files: ['skills/s/SKILL.md'],
      analysis: { verdict: 'improve' },
      comparison: {
        baseline: { runId: 'base1' },
        cases: [
          { case: 'c1', score: 1, baselineScore: 0.5 },
          { case: 'c2', score: 1, baselineScore: 1 },
        ],
      },
    });
    expect(e.costUsd).toBeCloseTo(0.9); // 3 stages + 2 eval invocations (one per case)
    for (const s of ['hypothesis', 'execute', 'eval', 'analyze'] as const)
      expect(e.stages?.[s]).toMatchObject({
        startedAt: expect.any(String),
        endedAt: expect.any(String),
      });
    expect(e.stages?.hypothesis?.runId).toBe('s-master');
    expect(e.stateProposal).toContain('Experiment 1: Tighten s');
    expect(git(root, 'log', '--format=%s', 'exp/1', '-1').trim()).toBe(
      'exp/1: Tighten s',
    );
    expect(
      t.msgs.filter((m) => m.type === 'experiments.changed').length,
    ).toBeGreaterThanOrEqual(9);

    // the eval ran on the worktree with the trust flag and the remaining budget
    const [, args, opts] = t.spawner.mock.calls[0]!;
    expect(opts).toMatchObject({ cwd: e.worktree });
    expect(args[2]).toBe(e.worktree);
    expect(args).toContain('--trust-plugin');
    // (5 - 0.2 spent - 0.5 analyst reserve) split between the 2 cases
    expect(Number(args[args.indexOf('--max-cost-usd') + 1])).toBeCloseTo(2.15);
    expect(t.spawner).toHaveBeenCalledTimes(2);
    expect(
      args.slice(args.indexOf('--ablation'), args.indexOf('--ablation') + 2),
    ).toEqual(['--ablation', 'none']);
    // nothing written to the main tree yet
    await expect(
      readFile(join(root, '.plugin-master/STATE.md'), 'utf8'),
    ).rejects.toThrow();

    const merged = await t.post('/1/merge');
    expect(merged.statusCode).toBe(200);
    expect(
      await readFile(join(root, '.plugin-master/STATE.md'), 'utf8'),
    ).toContain('Experiment 1: Tighten s');
    expect(
      await readFile(join(root, '.plugin-master/DECISIONS.md'), 'utf8'),
    ).toContain('merged exp/1 Tighten s');
    expect(git(root, 'ls-files')).not.toContain('evals/');
    expect(t.onError).not.toHaveBeenCalled();
  });
});

describe('ledger', () => {
  it('records the evaluated experiment; merge and discard are recorded as outcomes', async () => {
    const t = await setup();
    await t.post('/run', { maxCostUsd: 5, cases: ['c1', 'c2'] });
    await t.waitStatus('ready');
    const [r] = await readLedger(root);
    expect(r).toMatchObject({
      experiment: 1,
      kind: 'hypothesis',
      skills: ['s'],
      files: ['skills/s/SKILL.md'],
      changeType: 'instructions',
      hypothesis: 'Tighten s',
      diffSummary: 'did it',
      diffStat: { files: 1, additions: 1, deletions: 0 },
      evalRunIds: [expect.stringMatching(/^base1$/), expect.any(String)],
      suite: { cases: 2, verdict: 'inconclusive' },
      cases: [{ case: 'c1', delta: 0.5, n: 1 }, { case: 'c2', delta: 0 }],
      merged: null,
      lesson: 'c1 needs explicit wording',
    });
    expect(r!.head).toMatch(/^[0-9a-f]{40}$/);
    expect(r!.costUsd).toBeCloseTo(0.9);
    // the ledger is a file in the space, one line per record
    expect((await readFile(join(root, '.plugin-master/ledger.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1);

    await t.post('/1/merge');
    expect((await readLedger(root))[0]!.merged).toBe(true);
    expect(t.onError).not.toHaveBeenCalled();
  });

  it('discard records merged=false; the route returns records filtered by skill', async () => {
    const t = await setup();
    await t.post('/run', { maxCostUsd: 5 });
    await t.waitStatus('ready');
    await t.post('/1/discard');
    expect((await readLedger(root))[0]!.merged).toBe(false);
    const get = (q = '') => t.app.inject({ method: 'GET', url: `/spaces/s1/experiments/ledger${q}` });
    expect((await get()).json()).toHaveLength(1);
    expect((await get('?skill=s')).json()).toHaveLength(1);
    expect((await get('?skill=other')).json()).toEqual([]);
  });

  it('the master and analyst prompts get the bounded past-changes summary and the anti-repeat rule', async () => {
    const t = await setup();
    const rec = (skills: string[], hypothesis: string) => JSON.stringify({
      id: hypothesis, at: '2026-01-01T00:00:00Z', experiment: 9, kind: 'hypothesis', skills, files: [],
      changeType: 'instructions', hypothesis, diffSummary: '', diffStat: { files: 1, additions: 1, deletions: 0 },
      base: 'a', evalRunIds: [], cases: [], merged: false, lesson: 'it hurt', costUsd: 0,
      suite: { cases: 3, mean: -0.3, ci: [-0.4, -0.2], verdict: 'regressed' },
    });
    await writeFile(join(root, '.plugin-master/ledger.jsonl'), [rec(['s'], 'Add a long preamble'), 'not json', rec(['other'], 'Unrelated tweak')].join('\n') + '\n');
    await t.post('/run', { maxCostUsd: 5 });
    await t.waitStatus('ready');
    // the master does not know the skill yet: the whole plugin; the analyst: the skills the change touched
    expect(t.prompts.master).toContain('Add a long preamble');
    expect(t.prompts.master).toContain('Unrelated tweak');
    expect(t.prompts.analyst).toContain('Add a long preamble | regressed -0.30 [-0.40, -0.20] | discarded | lesson: it hurt');
    expect(t.prompts.analyst).not.toContain('Unrelated tweak');
    for (const p of [t.prompts.master, t.prompts.analyst])
      expect(p).toContain('Do not propose a change equivalent to one recorded as regressed or inconclusive');
  });
});

describe('failures', () => {
  it('executor without changes stops before the eval', async () => {
    const t = await setup({ noChange: true });
    await t.post('/run', { maxCostUsd: 5 });
    await t.waitStatus('failed');
    expect(await getExperiment(root, 1)).toMatchObject({
      error: 'executor made no changes',
      stages: { execute: { error: 'executor made no changes' } },
    });
    expect(t.spawner).not.toHaveBeenCalled();
  });

  it('cost cap exhausted by the SDK stages skips the eval', async () => {
    const t = await setup();
    await t.post('/run', { maxCostUsd: 0.15 });
    await t.waitStatus('failed');
    const e = await getExperiment(root, 1);
    expect(e.error).toMatch(/cost cap exhausted/);
    expect(e.stages?.eval?.error).toMatch(/cost cap/);
    expect(t.spawner).not.toHaveBeenCalled();
  });

  it('every SDK stage is capped by what is left of maxCostUsd', async () => {
    const t = await setup();
    await t.post('/run', { maxCostUsd: 5 });
    await t.waitStatus('ready');
    const caps = t.stageOptions.map((o) => o.maxBudgetUsd);
    // hypothesis 5, executor 4.9, analyst 5 - 0.2 - 0.3 (one eval invocation)
    expect(caps[0]).toBeCloseTo(5);
    expect(caps[1]).toBeCloseTo(4.9);
    expect(caps[2]).toBeCloseTo(4.5);
  });

  it('a failed stage keeps its cost', async () => {
    const t = await setup({ failResult: 'executor' });
    await t.post('/run', { maxCostUsd: 5 });
    await t.waitStatus('failed');
    const e = await getExperiment(root, 1);
    expect(e.stages?.execute).toMatchObject({ costUsd: 0.4, error: 'Stage failed: error_max_budget_usd' });
    expect(e.costUsd).toBeCloseTo(0.5);
  });

  it('an SDK error fails the stage', async () => {
    const t = await setup({ fail: 'master' });
    await t.post('/run', { maxCostUsd: 5 });
    await t.waitStatus('failed');
    expect(await getExperiment(root, 1)).toMatchObject({
      error: 'sdk boom',
      stages: { hypothesis: { error: 'sdk boom' } },
    });
  });

  it('validates the request and needs a trusted space', async () => {
    const t = await setup();
    expect((await t.post('/run', { maxCostUsd: 0 })).statusCode).toBe(400);
    expect((await t.post('/run', { maxCostUsd: 21 })).statusCode).toBe(400);
    expect((await t.post('/run', {})).statusCode).toBe(400);
    await writeFile(
      join(root, '.plugin-master/config.json'),
      JSON.stringify({
        masterContext: [],
        features: { git: true, masterLoop: true },
      }),
    );
    expect((await t.post('/run', { maxCostUsd: 1 })).json()).toEqual({
      error: { code: 'EVAL_UNTRUSTED' },
    });
    expect(await listExperiments(root)).toEqual([]);
  });
});

describe('hooks in frontmatter', () => {
  const hooked = '---\nname: s\nhooks:\n  Stop:\n    - hooks: [{ type: command, command: evil }]\n---\nskill\n';
  const waitAsk = async (t: Awaited<ReturnType<typeof setup>>) => {
    await vi.waitFor(() => expect(t.permissions.pendingFor('s1')).toHaveLength(1), { timeout: 5000 });
    const req = t.permissions.pendingFor('s1')[0] as Extract<ServerMessage, { type: 'permission.request' }>;
    expect(req).toMatchObject({
      requestId: expect.stringMatching(/^exp-1-/),
      toolName: 'Experiment 1: run eval with new hooks in skills/s/SKILL.md',
      input: { files: ['skills/s/SKILL.md'] },
    });
    return req.requestId;
  };

  it('new hooks need approval: deny fails before the eval', async () => {
    const t = await setup({ skill: hooked });
    await t.post('/run', { maxCostUsd: 5 });
    t.permissions.reply(await waitAsk(t), false);
    await t.waitStatus('failed');
    expect((await getExperiment(root, 1)).error).toBe('eval not approved: new hooks in skills/s/SKILL.md');
    expect(t.spawner).not.toHaveBeenCalled();
  });

  it('scaffold reaches the eval stage only when requested', async () => {
    const t = await setup({});
    await t.post('/run', { maxCostUsd: 5, scaffold: true });
    await t.waitStatus('ready');
    expect(t.spawner.mock.calls[0]![1]).toContain('--scaffold');
  });

  it('no --scaffold by default', async () => {
    const t = await setup({});
    await t.post('/run', { maxCostUsd: 5 });
    await t.waitStatus('ready');
    expect(t.spawner.mock.calls[0]![1]).not.toContain('--scaffold');
  });

  it('new hooks need approval: allow runs the eval', async () => {
    const t = await setup({ skill: hooked });
    await t.post('/run', { maxCostUsd: 5 });
    t.permissions.reply(await waitAsk(t), true);
    await t.waitStatus('ready');
    expect(t.spawner).toHaveBeenCalled();
  });

  it('a body edit with unchanged hooks is not asked', async () => {
    await writeFile(join(root, 'skills/s/SKILL.md'), hooked);
    git(root, 'commit', '-qam', 'hooks');
    const t = await setup({ skill: `${hooked}more\n` });
    await t.post('/run', { maxCostUsd: 5 });
    await t.waitStatus('ready');
    expect(t.msgs.some((m) => m.type === 'permission.request')).toBe(false);
  });

  it('a plain body edit is not asked', async () => {
    const t = await setup();
    await t.post('/run', { maxCostUsd: 5 });
    await t.waitStatus('ready');
    expect(t.msgs.some((m) => m.type === 'permission.request')).toBe(false);
  });
});

describe('conflicts', () => {
  it('one experiment at a time; merge and discard of a running one are refused', async () => {
    const t = await setup({ hang: 'master' });
    expect((await t.post('/run', { maxCostUsd: 5 })).statusCode).toBe(200);
    // the loop broadcasts the new record itself, the route does not repeat it
    expect(t.msgs.some((m) => m.type === 'experiments.changed')).toBe(true);
    expect(t.routeChange).not.toHaveBeenCalled();
    expect((await t.post('/run', { maxCostUsd: 5 })).json()).toEqual({
      error: { code: 'EXPERIMENT_RUNNING' },
    });
    expect((await t.post('/1/merge')).json()).toEqual({
      error: { code: 'EXPERIMENT_RUNNING' },
    });
    expect((await t.post('/1/discard')).json()).toEqual({
      error: { code: 'EXPERIMENT_RUNNING' },
    });
    expect((await t.post('/2/cancel')).json()).toEqual({
      error: { code: 'EXPERIMENT_NOT_RUNNING' },
    });
    expect((await t.post('/1/cancel')).statusCode).toBe(200);
    await t.waitStatus('failed');
    expect((await t.post('/1/discard')).statusCode).toBe(200);
    expect(await listExperiments(root)).toHaveLength(1);
  });

  it('a normal eval is refused while an experiment runs', async () => {
    const t = await setup({ hang: 'master' });
    await t.post('/run', { maxCostUsd: 5 });
    const r = await t.app.inject({ method: 'POST', url: '/spaces/s1/evals/run', payload: { maxCostUsd: 1 } });
    expect(r.json()).toEqual({ error: { code: 'EXPERIMENT_RUNNING' } });
    expect(t.spawner).not.toHaveBeenCalled();
    await t.post('/1/cancel');
    await t.waitStatus('failed');
  });

  it('a running record left by a crash is settled as failed on read; the live one is not', async () => {
    const t = await setup({ hang: 'master' });
    await t.post('/run', { maxCostUsd: 5 });
    const live = await getExperiment(root, 1);
    // experiment 2: what a crashed server left behind
    await lockedExp(root, () => saveExperiment(root, { ...live, id: 2, branch: 'exp/2' }));
    const get = (url: string) => t.app.inject({ method: 'GET', url: `/spaces/s1/experiments${url}` });
    const list = (await get('')).json() as { id: number; status: string; error?: string }[];
    expect(list.map((e) => [e.id, e.status, e.error])).toEqual([[1, 'running', undefined], [2, 'failed', INTERRUPTED]]);
    expect(await getExperiment(root, 2)).toMatchObject({ status: 'failed', error: INTERRUPTED });
    await t.post('/1/cancel');
    await t.waitStatus('failed');
    expect((await get('/1')).json()).toMatchObject({ status: 'failed', error: 'cancelled' });
  });

  it('refused while a normal eval runs', async () => {
    const t = await setup({ evalHangs: true });
    await t.evalRunner.start('s1', root, { maxCostUsd: 1 });
    expect((await t.post('/run', { maxCostUsd: 5 })).json()).toEqual({
      error: { code: 'EVAL_RUNNING' },
    });
    expect(await listExperiments(root)).toEqual([]);
    t.evalRunner.cancel('s1');
    await t.evalRunner.finished('s1');
  });
});

describe('cancel', () => {
  it.each([
    ['master', 'hypothesis'],
    ['executor', 'execute'],
    ['analyst', 'analyze'],
  ] as const)('during the %s stage', async (role, stage) => {
    const t = await setup({ hang: role });
    await t.post('/run', { maxCostUsd: 5 });
    await vi.waitFor(
      () => expect(t.seen.some((s) => s.startsWith(role))).toBe(true),
      { timeout: 5000 },
    );
    await t.post('/1/cancel');
    await t.waitStatus('failed');
    const e = await getExperiment(root, 1);
    expect(e.error).toBe('cancelled');
    expect(e.stages?.[stage]?.error).toBe('cancelled');
  });

  it('cancel drops a pending executor permission prompt', async () => {
    const t = await setup({ ask: true });
    await t.post('/run', { maxCostUsd: 5 });
    await vi.waitFor(() => expect(t.permissions.pendingFor('s1')).toHaveLength(1), { timeout: 5000 });
    await t.post('/1/cancel');
    await t.waitStatus('failed');
    expect(t.permissions.pendingFor('s1')).toEqual([]);
    expect(t.decisions).toEqual(['deny']);
  });

  it('during the eval stage (the eval runner is cancelled)', async () => {
    const t = await setup({ evalHangs: true });
    await t.post('/run', { maxCostUsd: 5 });
    await vi.waitFor(() => expect(t.procs).toHaveLength(1), { timeout: 5000 });
    await t.post('/1/cancel');
    await t.waitStatus('failed');
    expect(t.procs[0]!.kill).toHaveBeenCalledWith('SIGINT');
    expect(await getExperiment(root, 1)).toMatchObject({
      error: 'cancelled',
      stages: { eval: { error: 'cancelled' } },
    });
    expect(t.evalRunner.status('s1').state).toBe('cancelled');
  });
});
