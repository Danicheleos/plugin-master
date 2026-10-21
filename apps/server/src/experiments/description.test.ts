import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ExperimentSchema, type ServerMessage } from '@pm/protocol';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPermissions } from '../claude/permissions';
import { evalsRoutes } from '../evals/routes';
import { createEvalRunner, type EvalProcess } from '../evals/runner';
import type { AppError } from '../lib/errors';
import type { Recorder } from '../runs/recorder';
import { createRegistry } from '../spaces/registry';
import { descriptionGate, pickBest } from './description';
import { readLedger } from './ledger';
import { createExperimentLoop } from './loop';
import { experimentsRoutes } from './routes';
import type { StageQuery } from './stages';
import { getExperiment, listExperiments } from './store';
import { worktreesDir } from './worktree';

vi.mock('../evals/results', async (orig) => ({
  ...(await orig<object>()),
  readRunTrace: vi.fn(async () => ({ turns: [{ text: `TRACE-MARK ${'y'.repeat(400)}`, tools: [] }] })),
}));

Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const SKILL = (d: string) => `---\nname: s\n# keep me\ndescription: ${d}\nallowed-tools: Read\n---\nBody text\n`;

class FakeProc extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => void this.emit('close', 130));
}

/** Score by the worktree's description: GOOD = perfect, OVERFIT = train only, else half. Holdout case is `h1`. */
const scoreOf = (desc: string, name: string) =>
  desc.includes('GOOD') ? 1 : desc.includes('OVERFIT') ? (name === 'h1' ? 0 : 1) : 0.5;

let tmp: string;
let root: string;
let home: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pm-desc-'));
  root = join(tmp, 'plug');
  home = join(tmp, 'home');
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

type Opts = { cases?: Record<string, string[]>; proposals?: string[]; hang?: boolean; evalCost?: number; stageCost?: number };

async function setup(o: Opts = {}) {
  const cases = o.cases ?? { t1: ['trigger'], t2: ['trigger'], h1: ['trigger', 'holdout'], other: [] };
  await mkdir(join(root, 'skills/s'), { recursive: true });
  await mkdir(join(root, '.plugin-master'));
  await writeFile(
    join(root, '.plugin-master/config.json'),
    JSON.stringify({ masterContext: [], evalTrusted: true, features: { git: true, masterLoop: true } }),
  );
  for (const [name, tags] of Object.entries(cases)) {
    await mkdir(join(root, 'evals/cases', name), { recursive: true });
    await writeFile(join(root, 'evals/cases', name, 'case.yaml'), `name: ${name}\ntags: [${tags.join(', ')}]\n`);
  }
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'user.email', 't@t');
  await writeFile(join(root, '.gitignore'), '.plugin-master/\nevals/results/\n');
  await writeFile(join(root, 'skills/s/SKILL.md'), SKILL('original'));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'first');

  const msgs: ServerMessage[] = [];
  const broadcast = (_id: string, m: ServerMessage) => void msgs.push(m);
  const spawner = vi.fn((_c: string, args: string[], opts: { cwd: string }) => {
    const p = new FakeProc();
    setTimeout(async () => {
      const out = args[args.indexOf('--output-dir') + 1]!;
      const name = args[args.indexOf('--case') + 1]!;
      const desc = (await readFile(join(opts.cwd, 'skills/s/SKILL.md'), 'utf8')).match(/^description: (.*)$/m)![1]!;
      const score = scoreOf(desc, name);
      await mkdir(out, { recursive: true });
      await writeFile(
        join(out, 'aggregate-result.json'),
        JSON.stringify({
          schemaVersion: 1,
          startedAt: new Date().toISOString(),
          costUsd: o.evalCost ?? 0.1,
          suite: { ablation: 'none', plugins: [{ name: 'p' }] },
          cases: [
            {
              name,
              arms: {
                with: [{ score, passed: score >= 1, graders: score < 1 ? [{ name: 'tool_used', passed: false, explanation: `did not use Skill for ${name}` }] : [] }],
                without: [],
              },
              aggregates: { score },
            },
          ],
          aggregates: {},
        }),
      );
      p.emit('close', 0);
    }, 5);
    return p as unknown as EvalProcess;
  });
  const evalRunner = createEvalRunner({ broadcast, onSubscribe: () => undefined }, spawner as never);
  const prompts: string[] = [];
  const proposals = [...(o.proposals ?? [])];
  const queryFn: StageQuery = async function* ({ prompt, options }) {
    prompts.push(String(prompt));
    if (o.hang) {
      const signal = options.abortController!.signal;
      await new Promise<void>((r) => (signal.aborted ? r() : signal.addEventListener('abort', () => r())));
      throw new Error('killed');
    }
    yield {
      type: 'result',
      subtype: 'success',
      session_id: `s-${prompts.length}`,
      total_cost_usd: o.stageCost ?? 0.05,
      num_turns: 1,
      structured_output: { description: proposals.shift() ?? 'unused' },
    } as unknown as SDKMessage;
  };
  const recorder = { start: () => ({ user: () => undefined, message: () => undefined }) } as unknown as Recorder;
  const loop = createExperimentLoop({
    evalRunner,
    permissions: createPermissions(broadcast),
    recorder,
    queryFn,
    onError: vi.fn(),
    onChange: () => broadcast('s1', { type: 'experiments.changed', spaceId: 's1' }),
  });
  const registry = createRegistry(home);
  await registry.add({ id: 's1', name: 'p', path: root, createdAt: '' });
  const app = Fastify();
  app.setErrorHandler((e: AppError, _r, reply) => reply.code(e.status ?? 400).send({ error: { code: e.code } }));
  await app.register(experimentsRoutes(registry, home, vi.fn(), loop));
  await app.register(evalsRoutes(registry, evalRunner, loop.busy));
  const post = (url: string, payload?: object) =>
    app.inject({ method: 'POST', url: `/spaces/s1/experiments${url}`, payload });
  const run = (extra: object = {}) =>
    post('/run', { kind: 'description', skill: 's', maxCostUsd: 5, iterations: 1, ...extra });
  const waitStatus = (s: string) =>
    vi.waitFor(async () => expect((await getExperiment(root, 1)).status).toBe(s), { timeout: 5000 });
  return { run, post, waitStatus, prompts, msgs, spawner, ctx: { root, dir: worktreesDir(home, 's1') } };
}

describe('description optimizer', () => {
  it('happy path: best candidate lands in the worktree, only the description changes, holdout stays out of the proposer prompt', async () => {
    const t = await setup({ proposals: ['GOOD new description'] });
    const res = await t.run();
    expect(res.json()).toMatchObject({ id: 1, kind: 'description', skill: 's', status: 'running', iterations: 1 });
    await t.waitStatus('ready');
    const e = await getExperiment(root, 1);
    expect(e.trainCases).toEqual(['t1', 't2']);
    expect(e.holdoutCases).toEqual(['h1']);
    expect(e.candidates).toHaveLength(2);
    expect(e.candidates![0]).toMatchObject({ text: 'original', train: 0.5, holdout: 0.5 });
    expect(e.candidates![1]).toMatchObject({ text: 'GOOD new description', train: 1, holdout: 1, proposeRunId: 's-1' });
    expect(e.descriptionResult).toEqual({ bestIndex: 1, verdict: 'pass' });
    expect(e.costUsd).toBeCloseTo(0.1 * 3 + 0.05 + 0.1 * 3);
    expect(e.stateProposal).toContain('description of skill s');
    // lossless: only the description line differs
    expect(await readFile(join(e.worktree, 'skills/s/SKILL.md'), 'utf8')).toBe(
      SKILL('"GOOD new description"'),
    );
    expect(git(root, 'log', '--format=%s', 'exp/1', '-1').trim()).toBe('exp/1: description iteration 1');
    expect(git(root, 'diff', '--name-only', e.base, 'exp/1').trim()).toBe('skills/s/SKILL.md');
    // every eval covered train and holdout cases with 3 runs
    const calls = t.spawner.mock.calls.map((c) => c[1]);
    expect(calls).toHaveLength(6);
    expect(calls.every((a) => a.includes('--runs') && a[a.indexOf('--runs') + 1] === '3')).toBe(true);
    // proposer: sees train cases, failures, current description; never the holdout case
    expect(t.prompts).toHaveLength(1);
    expect(t.prompts[0]).toContain('Skill: s');
    expect(t.prompts[0]).toContain('original');
    expect(t.prompts[0]).toContain('t1');
    expect(t.prompts[0]).toContain('did not use Skill for t2');
    // short trace excerpts of the failed train cases (3 cases x 300 chars at most)
    expect(t.prompts[0]).toContain('### t1\nassistant: TRACE-MARK');
    expect(t.prompts[0]!.match(/TRACE-MARK/g)).toHaveLength(2);
    expect(t.prompts[0]).not.toContain('h1');
    expect(t.prompts[0]).not.toContain('holdout');
    expect(t.msgs.filter((m) => m.type === 'experiments.changed').length).toBeGreaterThan(5);

    // the ledger got the evaluated optimizer run (best vs original, holdout before/after)
    const [rec] = await readLedger(root);
    expect(rec).toMatchObject({
      kind: 'description', skills: ['s'], changeType: 'description', files: ['skills/s/SKILL.md'], merged: null,
      holdout: { before: 0.5, after: 1 }, suite: { cases: 3, verdict: 'improved' },
      diffStat: { files: 1, additions: 1, deletions: 1 }, lesson: expect.stringContaining('holdout 0.50 -> 1.00 (pass)'),
    });
    expect(rec!.diffSummary).toContain('GOOD new description');

    // merge reuses the existing route and notes the description change
    const merged = await t.post('/1/merge');
    expect((await readLedger(root))[0]!.merged).toBe(true);
    expect(merged.json()).toMatchObject({ status: "merged" });
    expect(await readFile(join(root, 'skills/s/SKILL.md'), 'utf8')).toContain('GOOD new description');
    const notes = await readFile(join(root, '.plugin-master/DECISIONS.md'), 'utf8');
    expect(notes).toContain('description of skill s');
    expect(notes).toContain('Description changed (verdict pass): GOOD new description');
  });

  it('a candidate that overfits (train up, holdout down) fails the verdict', async () => {
    const t = await setup({ proposals: ['OVERFIT text'] });
    await t.run();
    await t.waitStatus('ready');
    const e = await getExperiment(root, 1);
    expect(e.descriptionResult).toMatchObject({ bestIndex: 1, verdict: 'fail' });
    expect(e.candidates![1]).toMatchObject({ train: 1, holdout: 0 });
  });

  it('length gate: an over-long proposal is not written or evaluated and is reported to the next proposal', async () => {
    const t = await setup({ proposals: ['x'.repeat(1025), 'GOOD ok'] });
    await t.run({ iterations: 2 });
    await t.waitStatus('ready');
    const e = await getExperiment(root, 1);
    expect(e.candidates!.map((c) => c.text)).toEqual(['original', 'GOOD ok']);
    expect(t.prompts[1]).toContain('Rejected proposals');
    expect(t.prompts[1]).toContain('1025 chars');
    expect(git(root, 'log', '--format=%s', 'exp/1').split('\n').filter(Boolean)).toContain('first');
  });

  it('multi-line proposals are rejected', async () => {
    const t = await setup({ proposals: ['a\nb: c'] });
    await t.run();
    await t.waitStatus('ready');
    expect((await getExperiment(root, 1)).candidates).toHaveLength(1);
  });

  it('stops at the cost cap without calling the proposer', async () => {
    const t = await setup({ evalCost: 0.3, proposals: ['GOOD'] });
    await t.run({ maxCostUsd: 0.5 }); // the baseline eval spends 0.9
    await t.waitStatus('ready');
    const e = await getExperiment(root, 1);
    expect(t.prompts).toHaveLength(0);
    expect(e.candidates).toHaveLength(1);
    expect(e.descriptionResult?.warning).toContain('cost cap reached');
  });

  it('every stage gets what is left of the cap', async () => {
    const t = await setup({ proposals: ['GOOD'] });
    await t.run({ maxCostUsd: 2 });
    await t.waitStatus('ready');
    const budgets = t.spawner.mock.calls.map((c) => Number(c[1][c[1].indexOf('--max-cost-usd') + 1]));
    expect(budgets.slice(0, 3).every((b) => b! < 2 / 3 + 1e-3)).toBe(true); // 2 split between the 3 cases
    expect(budgets.slice(3).every((b) => b! < (2 - 0.3 - 0.05) / 3 + 1e-9)).toBe(true);
  });

  it('cancel stops the run as failed/cancelled', async () => {
    const t = await setup({ hang: true });
    await t.run();
    await vi.waitFor(async () => expect((await getExperiment(root, 1)).stage).toBe('propose'), { timeout: 5000 });
    expect((await t.post('/1/cancel')).statusCode).toBe(200);
    await t.waitStatus('failed');
    expect(await getExperiment(root, 1)).toMatchObject({ error: 'cancelled' });
  });

  it('no holdout cases: allowed, verdict unknown with a warning', async () => {
    const t = await setup({ cases: { t1: ['trigger'], t2: ['trigger'] }, proposals: ['GOOD'] });
    await t.run();
    await t.waitStatus('ready');
    const e = await getExperiment(root, 1);
    expect(e.descriptionResult).toMatchObject({ bestIndex: 1, verdict: 'unknown' });
    expect(e.descriptionResult?.warning).toContain('no holdout cases');
    expect(e.candidates![1]!.holdout).toBeUndefined();
  });

  it('refuses without train cases or without the skill, creating nothing', async () => {
    const t = await setup({ cases: { h1: ['trigger', 'holdout'], x: [] } });
    const r = await t.run();
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('NO_TRIGGER_CASES');
    const r2 = await t.run({ skill: 'nope' });
    expect(r2.statusCode).toBe(404);
    expect(await listExperiments(root)).toEqual([]);
    expect((await t.run({ skill: undefined })).statusCode).toBe(400);
    expect((await t.run({ iterations: 6 })).statusCode).toBe(400);
  });

  it('only one experiment per space', async () => {
    const t = await setup({ hang: true });
    await t.run();
    expect((await t.run()).statusCode).toBe(409);
    await t.post('/1/cancel');
    await t.waitStatus('failed');
  });
});

describe('helpers and compatibility', () => {
  it('pickBest: best train score, ties go to the shorter text', () => {
    const c = (text: string, train: number) => ({ text, train, costUsd: 0 });
    expect(pickBest([c('aaaa', 0.5), c('bb', 0.5)])).toBe(1);
    expect(pickBest([c('a', 0.5), c('bbbb', 0.9), c('b', 0.9)])).toBe(2);
    expect(pickBest([c('a', 1), c('bbbb', 0.9)])).toBe(0);
  });
  it('descriptionGate', () => {
    expect(descriptionGate('')).toBeDefined();
    expect(descriptionGate('x'.repeat(1024))).toBeUndefined();
    expect(descriptionGate('x'.repeat(1025))).toBeDefined();
    expect(descriptionGate('a\nb')).toBeDefined();
    expect(descriptionGate('fine')).toBeUndefined();
  });
  it('old records without kind still parse', () => {
    const old = {
      id: 3, branch: 'exp/3', base: 'a'.repeat(40), worktree: '/w', status: 'ready',
      createdAt: 'x', updatedAt: 'y', hypothesis: 'h', stages: { hypothesis: { startedAt: 'x' } },
    };
    const e = ExperimentSchema.parse(old);
    expect(e.kind).toBeUndefined();
    expect(e.candidates).toBeUndefined();
  });
});
