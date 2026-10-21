import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  EvalRunRequestSchema,
  FeaturesSchema,
  type ServerMessage,
} from '@pm/protocol';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../lib/errors';
import { createRegistry } from '../spaces/registry';
import { evalsRoutes } from './routes';
import { buildArgs, createEvalRunner, type EvalProcess } from './runner';

class FakeProc extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn();
  exit(code: number | null) {
    this.emit('close', code);
  }
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pm-evalrun-'));
  await mkdir(join(root, '.plugin-master'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const trust = (trusted: boolean) =>
  writeFile(
    join(root, '.plugin-master/config.json'),
    JSON.stringify({
      masterContext: ['a.md'],
      activePlan: 'p1',
      evalTrusted: trusted,
    }),
  );

type Client = { send(m: ServerMessage): void };

async function setup() {
  const registry = createRegistry(root);
  await registry.add({ id: 's1', name: 'p', path: root, createdAt: '' });
  const msgs: ServerMessage[] = [];
  const subscribers: ((id: string, c: Client) => void)[] = [];
  const hub = {
    broadcast: (_id: string, m: ServerMessage) => void msgs.push(m),
    onSubscribe: (h: (id: string, c: Client) => void) =>
      void subscribers.push(h),
  };
  const procs: FakeProc[] = [];
  const spawner = vi.fn((_c: string, _a: string[], _o: object) => {
    const p = new FakeProc();
    procs.push(p);
    return p as unknown as EvalProcess;
  });
  const runner = createEvalRunner(hub, spawner);
  const app = Fastify();
  app.setErrorHandler((e: AppError, _r, reply) =>
    reply.code(e.status ?? 400).send({ error: { code: e.code } }),
  );
  await app.register(evalsRoutes(registry, runner));
  const run = (payload: object = { maxCostUsd: 1 }) =>
    app.inject({ method: 'POST', url: '/spaces/s1/evals/run', payload });
  const cancel = () =>
    app.inject({ method: 'POST', url: '/spaces/s1/evals/cancel' });
  const statuses = () =>
    msgs
      .flatMap((m) => (m.type === 'eval.status' ? [m.state] : []))
      .filter((s, i, a) => s !== a[i - 1]);
  const settle = () => new Promise((r) => setTimeout(r, 20));
  return {
    runner,
    app,
    run,
    cancel,
    msgs,
    procs,
    spawner,
    subscribers,
    statuses,
    settle,
  };
}

describe('buildArgs', () => {
  it('puts the target first and adds filters and the trust flag', () => {
    const req = EvalRunRequestSchema.parse({
      cases: ['a*'],
      tags: ['x', 'y'],
      runs: 2,
      maxCostUsd: 1.5,
      model: 'haiku',
      ablation: true,
    });
    const args = buildArgs('/r', '/r/evals/results/t', req, true);
    expect(args.slice(0, 4)).toEqual(['plugin', 'eval', '/r', '--json']);
    expect(args).toContain('--no-publish');
    expect(args).toContain('--keep-temp');
    expect(args.join(' ')).toContain(
      '--max-cost-usd 1.5 --case a* --tag x --tag y --runs 2 --model haiku --ablation with-without',
    );
    expect(args.at(-1)).toBe('--trust-plugin');
    const plain = buildArgs(
      '/r',
      '/o',
      EvalRunRequestSchema.parse({ maxCostUsd: 1 }),
      false,
    );
    expect(plain.join(' ')).toMatch(/--ablation none$/);
    expect(buildArgs('/r', '/o', req, false)).not.toContain('--trust-plugin');
  });

  it('adds --scaffold only when requested', () => {
    const on = EvalRunRequestSchema.parse({ maxCostUsd: 1, scaffold: true });
    const off = EvalRunRequestSchema.parse({ maxCostUsd: 1 });
    expect(buildArgs('/r', '/o', on, false)).toContain('--scaffold');
    expect(buildArgs('/r', '/o', off, false)).not.toContain('--scaffold');
  });

  it('passes --allow-tools with the granted tools only when given', () => {
    const on = EvalRunRequestSchema.parse({
      maxCostUsd: 1,
      allowTools: ['Bash', 'Write'],
    });
    const off = EvalRunRequestSchema.parse({ maxCostUsd: 1 });
    expect(buildArgs('/r', '/o', on, false).join(' ')).toContain(
      '--allow-tools Bash Write',
    );
    expect(buildArgs('/r', '/o', off, false)).not.toContain('--allow-tools');
    expect(
      EvalRunRequestSchema.safeParse({
        maxCostUsd: 1,
        allowTools: ['--scaffold'],
      }).success,
    ).toBe(false);
  });

  it('rejects option-like values and a missing cost limit', () => {
    for (const bad of [
      { maxCostUsd: 1, cases: ['-x'] },
      { maxCostUsd: 1, cases: ['a\0'] },
      { maxCostUsd: 1, tags: ['--scaffold'] },
      { maxCostUsd: 1, model: '-m' },
      { maxCostUsd: 0 },
      { maxCostUsd: 1, runs: 51 },
      {},
    ])
      expect(EvalRunRequestSchema.safeParse(bad).success).toBe(false);
  });
});

describe('eval runner', () => {
  it('refuses to run until the plugin is trusted', async () => {
    const t = await setup();
    const res = await t.run();
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EVAL_UNTRUSTED');
    expect(t.spawner).not.toHaveBeenCalled();
  });

  it('stores trust without losing other config fields', async () => {
    const t = await setup();
    await trust(false);
    const res = await t.app.inject({
      method: 'PUT',
      url: '/spaces/s1/evals/trust',
      payload: { trusted: true },
    });
    expect(res.json()).toEqual({ trusted: true });
    const file = join(root, '.plugin-master/config.json');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      masterContext: ['a.md'],
      activePlan: 'p1',
      evalTrusted: true,
      evalBaselines: {},
      evalRefs: {},

      features: FeaturesSchema.parse({}),
    });
  });

  it('streams lines, allows one run at a time and maps exit 0 to done', async () => {
    const t = await setup();
    await trust(true);
    const res = await t.run({ maxCostUsd: 1 });
    expect(res.statusCode).toBe(200);
    const { runId } = res.json();
    expect(runId).not.toContain(':');
    const [, args, opts] = t.spawner.mock.calls[0];
    expect(args).toContain('--trust-plugin');
    expect(args).toContain(join(root, 'evals/results', runId));
    expect(opts).toEqual({
      cwd: root,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect((await t.run()).json().error.code).toBe('EVAL_RUNNING');

    t.procs[0].stdout.write('hello\nwor');
    t.procs[0].stderr.write('oops\n');
    t.procs[0].stdout.write('ld\n');
    await t.settle();
    t.procs[0].exit(0);
    await vi.waitFor(() => expect(t.statuses()).toEqual(['running', 'done']));
    expect(
      t.msgs.flatMap((m) =>
        m.type === 'eval.output' ? [`${m.stream}:${m.line}`] : [],
      ),
    ).toEqual(['stdout:hello', 'stderr:oops', 'stdout:world']);
    expect(t.statuses()).toEqual(['running', 'done']);
    expect(t.msgs.at(-1)).toMatchObject({ exitCode: 0, runId });

    const sent: ServerMessage[] = [];
    t.subscribers[0]('s1', { send: (m) => void sent.push(m) });
    expect(sent[0]).toMatchObject({
      type: 'eval.history',
      status: { state: 'done' },
    });
    expect(sent[0].type === 'eval.history' && sent[0].lines).toHaveLength(3);
    expect((await t.run()).statusCode).toBe(200); // lock released
  });

  it('runs several selected cases one invocation each, sequentially, under one lock', async () => {
    const t = await setup();
    await trust(true);
    const { runId } = (
      await t.run({ maxCostUsd: 1, cases: ['a', 'b'] })
    ).json();
    expect(t.spawner).toHaveBeenCalledTimes(1);
    expect(t.spawner.mock.calls[0][1].join(' ')).toContain(
      '--max-cost-usd 0.5 --case a',
    );
    expect((await t.run()).json().error.code).toBe('EVAL_RUNNING');
    t.procs[0].exit(0);
    await vi.waitFor(async () => {
      expect(t.spawner).toHaveBeenCalledTimes(2);
    });
    const args = t.spawner.mock.calls[1][1];
    expect(args.join(' ')).toContain('--case b');
    expect(args).toContain(join(root, 'evals/results', `${runId}-2`));
    expect(t.statuses()).toEqual(['running']);
    t.procs[1].exit(0);
    await vi.waitFor(async () => {
      expect(t.statuses()).toEqual(['running', 'done']);
    });
    expect(t.msgs.at(-1)).toMatchObject({ runId });
  });

  it('reports per-case progress with scores from each aggregate', async () => {
    const t = await setup();
    await trust(true);
    const { runId } = (
      await t.run({ maxCostUsd: 1, cases: ['a', 'b'] })
    ).json();
    const progress = () => {
      const m = [...t.msgs].reverse().find((x) => x.type === 'eval.status');
      return m?.type === 'eval.status' ? m.progress : undefined;
    };
    expect(progress()).toEqual({
      total: 2,
      done: 0,
      current: 'a',
      cases: [
        { name: 'a', state: 'running' },
        { name: 'b', state: 'queued' },
      ],
    });
    const dir = join(root, 'evals/results', runId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'aggregate-result.json'),
      JSON.stringify({ aggregates: { overallScore: 0.75 } }),
    );
    t.procs[0].exit(0);
    await vi.waitFor(() => expect(t.spawner).toHaveBeenCalledTimes(2));
    expect(progress()).toMatchObject({
      done: 1,
      current: 'b',
      cases: [
        { name: 'a', state: 'done', score: 0.75 },
        { name: 'b', state: 'running' },
      ],
    });
    const sent: ServerMessage[] = [];
    t.subscribers[0]('s1', { send: (m) => void sent.push(m) });
    expect(
      sent[0].type === 'eval.history' && sent[0].status.progress?.done,
    ).toBe(1);
    t.procs[1].exit(3);
    await vi.waitFor(() => expect(t.statuses().at(-1)).toBe('done'));
    expect(progress()?.cases[1]).toEqual({ name: 'b', state: 'failed' });
    expect(progress()).toMatchObject({ done: 2, current: null });
  });

  it('expands a run without cases to the suite cases (tags narrow them), splitting the cost', async () => {
    const t = await setup();
    await trust(true);
    for (const [n, tag] of [
      ['a', 'x'],
      ['b', 'y'],
      ['c', 'x'],
    ])
      await mkdir(join(root, 'evals', n), { recursive: true }).then(() =>
        writeFile(
          join(root, 'evals', n, 'prompt.md'),
          `---\ntags: [${tag}]\n---\nhi`,
        ),
      );
    const { runId } = (await t.run({ maxCostUsd: 1, tags: ['x'] })).json();
    expect(t.spawner.mock.calls[0][1].join(' ')).toContain(
      '--max-cost-usd 0.5 --case a --tag x',
    );
    t.procs[0].exit(0);
    await vi.waitFor(() => expect(t.spawner).toHaveBeenCalledTimes(2));
    const args = t.spawner.mock.calls[1][1];
    expect(args.join(' ')).toContain('--case c');
    expect(args).toContain(join(root, 'evals/results', `${runId}-2`));
    t.procs[1].exit(0);
    await vi.waitFor(() => expect(t.statuses().at(-1)).toBe('done'));
  });

  it('cancel stops the sequence of cases', async () => {
    const t = await setup();
    await trust(true);
    await t.run({ maxCostUsd: 1, cases: ['a', 'b', 'c'] });
    await t.cancel();
    t.procs[0].exit(130);
    // wait for the end state, then check no further case was spawned (a negative cannot be polled)
    await vi.waitFor(async () => {
      expect(t.statuses()).toEqual(['running', 'cancelled']);
    });
    expect(t.spawner).toHaveBeenCalledTimes(1);
  });

  it('cancel right after start (before any process) is accepted and ends cancelled', async () => {
    const t = await setup();
    await trust(true);
    await t.run({ maxCostUsd: 1, cases: ['a', 'b'] });
    expect((await t.cancel()).statusCode).toBe(204);
    await vi.waitFor(() => expect(t.procs.length).toBeLessThanOrEqual(1));
    t.procs[0]?.exit(130); // the sidecar write may or may not have finished first
    await vi.waitFor(() => expect(t.statuses().at(-1)).toBe('cancelled'));
    expect(t.spawner.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('cancel sends SIGINT and reports cancelled', async () => {
    const t = await setup();
    await trust(true);
    await t.run();
    expect((await t.cancel()).statusCode).toBe(204);
    expect(t.procs[0].kill).toHaveBeenCalledWith('SIGINT');
    t.procs[0].exit(130);
    await vi.waitFor(async () => {
      expect(t.statuses()).toEqual(['running', 'cancelled']);
    });
    expect((await t.cancel()).statusCode).toBe(409);
  });

  it('maps exit codes: 1/2 are done only with a result file', async () => {
    const t = await setup();
    await trust(true);
    await t.run();
    t.procs[0].exit(1);
    await vi.waitFor(async () => {
      expect(t.msgs.at(-1)).toMatchObject({ state: 'failed', exitCode: 1 });
    });

    const second = (await t.run()).json();
    const dir = join(root, 'evals/results', second.runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'aggregate-result.json'), '{}');
    t.procs[1].exit(2);
    await vi.waitFor(async () => {
      expect(t.msgs.at(-1)).toMatchObject({ state: 'done', exitCode: 2 });
    });

    await t.run();
    t.procs[2].exit(3);
    await vi.waitFor(async () => {
      expect(t.msgs.at(-1)).toMatchObject({ state: 'failed', exitCode: 3 });
    });
  });

  it('reports a missing claude binary as failed', async () => {
    const t = await setup();
    await trust(true);
    await t.run();
    t.procs[0].emit(
      'error',
      Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }),
    );
    t.procs[0].exit(null);
    await vi.waitFor(async () => {
      expect(t.statuses()).toEqual(['running', 'failed']);
    });
    expect(
      t.msgs.some(
        (m) => m.type === 'eval.output' && m.line.includes('not found'),
      ),
    ).toBe(true);
  });

  it('kills a running process when the runner closes', async () => {
    const t = await setup();
    await trust(true);
    await t.run();
    t.runner.close();
    expect(t.procs[0].kill).toHaveBeenCalledWith('SIGTERM');
  });
});
