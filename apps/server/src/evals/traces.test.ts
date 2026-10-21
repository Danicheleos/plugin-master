import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { listSuites, readRun } from './results';
import { harvestTraces, keptPaths } from './traces';

const fx = (n: string) => join(__dirname, '__fixtures__', n);
let tmp: string;
let space: string;
const extra: string[] = [];

const exists = (p: string) => stat(p).then(() => true, () => false);

/** Writes `two-arm.json` with the given tracePath on every arm run. */
async function putRun(id: string, tracePath?: string) {
  const dir = join(space, 'evals/results', id);
  await mkdir(dir, { recursive: true });
  const r = JSON.parse(await readFile(fx('two-arm.json'), 'utf8'));
  for (const c of r.cases)
    for (const arm of ['with', 'without']) for (const run of c.arms[arm]) run.tracePath = tracePath;
  await writeFile(join(dir, 'aggregate-result.json'), JSON.stringify(r));
  return { dir, startedAt: r.startedAt as string };
}

/** A kept sandbox like the CLI one: a tmp dir named e-xxxx with out/trace.jsonl. */
async function sandbox() {
  const dir = await mkdtemp(join(tmpdir(), 'e-'));
  extra.push(dir);
  await mkdir(join(dir, 'out'));
  await cp(fx('trace.jsonl'), join(dir, 'out/trace.jsonl'));
  return dir;
}

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pm-evals-'));
  space = join(tmp, 'plug');
  await mkdir(space);
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  await Promise.all(extra.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('harvestTraces', () => {
  it('copies traces per arm and case and removes the e-* sandbox', async () => {
    const sb = await sandbox();
    const { dir } = await putRun('r1', join(sb, 'out/trace.jsonl'));
    const log: string[] = [];
    await harvestTraces(dir, (l) => log.push(l));
    expect(await exists(join(dir, 'traces/with/delta-1.jsonl'))).toBe(true);
    expect(await exists(join(dir, 'traces/without/delta-1.jsonl'))).toBe(true);
    expect(await exists(sb)).toBe(false);
    expect(log).toEqual([]);
  });

  it('removes a read-only sandbox with a mode-000 sealed dir', async () => {
    const sb = await sandbox();
    await mkdir(join(sb, 'sealed/home'), { recursive: true });
    await chmod(join(sb, 'sealed'), 0o000);
    await chmod(sb, 0o500);
    const { dir } = await putRun('r1', join(sb, 'out/trace.jsonl'));
    const log: string[] = [];
    await harvestTraces(dir, (l) => log.push(l));
    expect(await exists(sb)).toBe(false);
    expect(log).toEqual([]);
  });

  it('removes sandboxes the CLI printed as kept, but never other paths or symlinks', async () => {
    const sb = await sandbox();
    const other = await mkdtemp(join(tmpdir(), 'not-eval-'));
    extra.push(other);
    const link = join(tmpdir(), `e-link-${process.pid}`);
    await symlink(other, link);
    extra.push(link);
    const out = join(tmp, 'out');
    await mkdir(out);
    const kept = keptPaths([
      `⚠ kept ${sb}: home/ and tmp/ in it were written by the plugin`,
      `⚠ kept ${other}: x`,
      `⚠ kept ${link}: x`,
      'Wrote /x/aggregate-result.json',
    ]);
    expect(kept).toEqual([sb, other, link]);
    await harvestTraces(out, () => undefined, kept); // no aggregate-result.json
    expect(await exists(sb)).toBe(false);
    expect(await exists(other)).toBe(true);
    expect(await exists(other + '/..')).toBe(true);
  });

  it('keeps directories that are not an e-* sandbox under the temp dir', async () => {
    const other = await mkdtemp(join(tmpdir(), 'not-eval-'));
    extra.push(other);
    await cp(fx('trace.jsonl'), join(other, 'trace.jsonl'));
    const { dir } = await putRun('r1', join(other, 'trace.jsonl'));
    await harvestTraces(dir, () => undefined);
    expect(await exists(join(dir, 'traces/with/delta-1.jsonl'))).toBe(true);
    expect(await exists(join(other, 'trace.jsonl'))).toBe(true);
  });

  it('ignores missing trace files and missing results, and logs unreadable results', async () => {
    const log: string[] = [];
    const { dir } = await putRun('r1', join(tmp, 'gone/trace.jsonl'));
    await harvestTraces(dir, (l) => log.push(l));
    await harvestTraces(join(tmp, 'nothing'), (l) => log.push(l));
    expect(log).toEqual([]);
    await writeFile(join(dir, 'aggregate-result.json'), '{bad');
    await harvestTraces(dir, (l) => log.push(l));
    expect(log).toHaveLength(1);
  });
});

describe('trace lookup', () => {
  it('attaches metrics from our layout and serves the parsed trace', async () => {
    const { dir } = await putRun('r1');
    await mkdir(join(dir, 'traces/with'), { recursive: true });
    await cp(fx('trace.jsonl'), join(dir, 'traces/with/delta-1.jsonl'));
    const run = (await readRun(space, 'r1')).result.cases[0];
    expect(run?.arms.with[0]?.traceMetrics?.modelCalls).toBe(3);
    expect(run?.arms.without[0]?.traceMetrics).toBeUndefined();
  });

  it('reads the harness layout by startedAt and only for the with arm', async () => {
    const { startedAt } = await putRun('r1');
    const key = startedAt.replace(/[:.]/g, '-');
    const d = join(space, 'evals/results/traces/plugin', key);
    await mkdir(d, { recursive: true });
    await cp(fx('trace.jsonl'), join(d, 'delta-1.jsonl'));
    const c = (await readRun(space, 'r1')).result.cases[0];
    expect(c?.arms.with[0]?.traceMetrics?.toolCallsTotal).toBe(3);
    expect(c?.arms.without[0]?.traceMetrics).toBeUndefined();
  });
});

describe('trace route', () => {
  it('serves a parsed trace, 404 without one, 400 for a bad query', async () => {
    const app = buildApp({ port: 0, webOrigins: [], token: 't', home: join(tmp, 'h') });
    const headers = { authorization: 'Bearer t' };
    try {
      const { id } = (
        await app.inject({ method: 'POST', url: '/api/spaces', headers, payload: { path: space, name: 'plug' } })
      ).json();
      const { dir } = await putRun('plugin-eval');
      await mkdir(join(dir, 'traces/with'), { recursive: true });
      await cp(fx('trace.jsonl'), join(dir, 'traces/with/delta-1.jsonl'));
      const get = (q: string) =>
        app.inject({ url: `/api/spaces/${id}/evals/runs/plugin-eval/trace?${q}`, headers });
      const ok = await get('case=delta&arm=with&n=1');
      expect(ok.statusCode).toBe(200);
      expect(ok.json().metrics.modelCalls).toBe(3);
      expect(ok.json().turns[1].tools[0].turns).toHaveLength(1);
      expect((await get('case=delta&arm=without&n=1')).statusCode).toBe(404);
      expect((await get('case=..%2Fx&arm=with&n=1')).statusCode).toBe(400);
      expect((await get('case=delta&arm=with&n=0')).statusCode).toBe(400);
      expect((await get('case=delta&arm=nope&n=1')).statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('suites carry tokens from a real-shaped trace and none without one', async () => {
    const { dir } = await putRun('r1');
    const ids = async () => (await listSuites(space)).suites.flatMap((x) => x.cases.map((c) => c.latest.tokens));
    expect(await ids()).toEqual([undefined]);
    await mkdir(join(dir, 'traces/with'), { recursive: true });
    await cp(fx('trace.jsonl'), join(dir, 'traces/with/delta-1.jsonl'));
    const m = (await readRun(space, 'r1')).result.cases[0]?.arms.with[0]?.traceMetrics;
    expect(m).toBeDefined();
    expect(await ids()).toEqual([m!.inputTokens + m!.outputTokens]);
  });
});
