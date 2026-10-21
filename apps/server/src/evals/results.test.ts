import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { evalDir } from './eval-dir';
import { listGroups, loadRuns, readGroup, readMerged, readReport, readRun } from './results';

const listRuns = async (root: string) => (await loadRuns(root)).map((r) => r.summary);

const fx = (n: string) => join(__dirname, '__fixtures__', n);
let tmp: string;
let space: string;

async function put(id: string, fixture: string, report = false) {
  const dir = join(space, 'evals/results', id);
  await mkdir(dir, { recursive: true });
  await cp(fx(fixture), join(dir, 'aggregate-result.json'));
  if (report) await writeFile(join(dir, 'report.html'), '<h1>r</h1>');
}

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pm-evals-'));
  space = join(tmp, 'plug');
  await mkdir(space);
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

describe('eval results', () => {
  it('lists runs, nested runs included, broken file as error', async () => {
    await put('a', 'passing.json', true);
    await put('b', 'partial.json');
    await put('plugin-eval', 'two-arm.json');
    await put('x/y', 'passing.json');
    await put('bad', 'broken.json');
    const runs = await listRuns(space);
    const by = Object.fromEntries(runs.map((r) => [r.id, r]));
    expect(runs).toHaveLength(5);
    expect(by['bad']?.error).toBeTruthy();
    expect(by['a']).toMatchObject({ overallScore: 1, casesTotal: 1, hasReport: true, skippedPaid: false });
    expect(by['b']).toMatchObject({ partial: true, partialReason: 'cost_ceiling', skippedPaid: true });
    expect(by['plugin-eval']?.ablation).toBe('with-without');
  });

  it('lists top-level result files with a schemaVersion as runs (id = file name)', async () => {
    await put('a', 'passing.json');
    await cp(fx('two-arm.json'), join(space, 'evals/results/bare.json'));
    await writeFile(join(space, 'evals/results/notes.json'), '{"x":1}');
    await writeFile(join(space, 'evals/results/broken.json'), '{bad');
    const runs = await listRuns(space);
    expect(runs.map((r) => r.id).sort()).toEqual(['a', 'bare.json']);
    expect(runs.find((r) => r.id === 'bare.json')).toMatchObject({ hasReport: false, ablation: 'with-without' });
    const run = await readRun(space, 'bare.json');
    expect(run.result.cases[0]?.name).toBeTruthy();
    expect((await readGroup(space, 'bare.json')).group.runIds).toContain('bare.json');
    await expect(readReport(space, 'bare.json')).rejects.toThrow();
  });

  it('reads a run and flags an unknown schemaVersion', async () => {
    await put('a', 'two-arm.json');
    const ok = await readRun(space, 'a');
    expect(ok.unknownSchema).toBe(false);
    expect(ok.result.cases[0]?.aggregates.delta).toBe(0.5);
    const raw = JSON.parse(await readFile(fx('passing.json'), 'utf8'));
    await mkdir(join(space, 'evals/results/v2'), { recursive: true });
    await writeFile(
      join(space, 'evals/results/v2/aggregate-result.json'),
      JSON.stringify({ ...raw, schemaVersion: 2, newField: 1 }),
    );
    expect((await readRun(space, 'v2')).unknownSchema).toBe(true);
  });

  it('rejects traversal and symlinks out of the space', async () => {
    await put('a', 'passing.json');
    await expect(readRun(space, '../a')).rejects.toMatchObject({ status: 400 });
    await expect(readRun(space, 'a/../../x')).rejects.toMatchObject({ status: 400 });
    await expect(readRun(space, 'missing')).rejects.toMatchObject({ status: 404 });
    await mkdir(join(tmp, 'outside'));
    await cp(fx('passing.json'), join(tmp, 'outside/aggregate-result.json'));
    await symlink(join(tmp, 'outside'), join(space, 'evals/results/link'));
    await expect(readRun(space, 'link')).rejects.toMatchObject({ status: 400 });
    expect((await listRuns(space)).map((r) => r.id)).toEqual(['a']);
  });

  it('does not follow a symlinked report.html or aggregate file out of the space', async () => {
    await put('a', 'passing.json');
    await writeFile(join(tmp, 'secret.html'), 'secret');
    await symlink(join(tmp, 'secret.html'), join(space, 'evals/results/a/report.html'));
    expect((await listRuns(space))[0]?.hasReport).toBe(false);
    await expect(readReport(space, 'a')).rejects.toMatchObject({ status: 400 });
  });

  it('reads the eval dir from plugin.json', async () => {
    expect(await evalDir(space)).toBe('evals');
    await mkdir(join(space, '.claude-plugin'));
    await writeFile(
      join(space, '.claude-plugin/plugin.json'),
      JSON.stringify({ experimental: { evals: './my-evals/' } }),
    );
    expect(await evalDir(space)).toBe('my-evals');
  });
});

describe('eval groups on disk', () => {
  async function putCase(id: string, name: string, startedAt: string, score: number) {
    const raw = JSON.parse(await readFile(fx('passing.json'), 'utf8'));
    raw.startedAt = startedAt;
    raw.cases[0].name = name;
    raw.cases[0].aggregates.score = score;
    const dir = join(space, 'evals/results', id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'aggregate-result.json'), JSON.stringify(raw));
  }

  it('merges a batch of single-case runs, keeping every invocation', async () => {
    await putCase('r1', 'a', '2026-01-01T10:00:00.000Z', 0);
    await putCase('r2', 'b', '2026-01-01T10:01:00.000Z', 1);
    await putCase('r3', 'a', '2026-01-01T10:02:00.000Z', 1);
    await putCase('late', 'a', '2026-01-02T10:00:00.000Z', 1);
    const groups = await listGroups(space);
    expect(groups.map((g) => g.runIds)).toEqual([['late'], ['r1', 'r2', 'r3']]);
    const merged = await readGroup(space, 'r1');
    // the viewer gets every invocation; the aggregates count the latest per case
    expect(merged.result.cases.map((c) => [c.name, c.runId])).toEqual([
      ['a', 'r1'],
      ['b', 'r2'],
      ['a', 'r3'],
    ]);
    const [group] = (await listGroups(space)).slice(1);
    expect((await readMerged(space, group as NonNullable<typeof group>)).cases.map((c) => [c.name, c.runId])).toEqual([
      ['a', 'r3'],
      ['b', 'r2'],
    ]);
    expect(merged.result.aggregates).toMatchObject({ casesTotal: 2, casesPassed: 2, overallScore: 1 });
    expect(merged.group.totalRuns).toBe(3);
    // an earlier run lands later: the group id changes, the old id still opens the group
    await putCase('r0', 'c', '2026-01-01T09:59:00.000Z', 1);
    const again = await readGroup(space, 'r1');
    expect(again.group.runIds).toEqual(['r0', 'r1', 'r2', 'r3']);
    await expect(readGroup(space, 'nope')).rejects.toMatchObject({ status: 404 });
  });
});

describe('eval routes', () => {
  it('serves runs, a run and the sandboxed report', async () => {
    const app = buildApp({ port: 0, webOrigins: [], token: 't', home: join(tmp, 'h') });
    const headers = { authorization: 'Bearer t' };
    try {
      const { id } = (
        await app.inject({
          method: 'POST',
          url: '/api/spaces',
          headers,
          payload: { path: space, name: 'plug' },
        })
      ).json();
      await put('plugin-eval', 'passing.json', true);
      const base = `/api/spaces/${id}/evals`;
      const list = (await app.inject({ url: `${base}/runs`, headers })).json();
      expect(list.dir).toBe('evals');
      expect(list.groups[0].runIds).toEqual(['plugin-eval']);
      const run = await app.inject({ url: `${base}/runs/plugin-eval`, headers });
      expect(run.json().result.cases[0].name).toBe('basic');
      const rep = await app.inject({ url: `${base}/report/plugin-eval`, headers });
      expect(rep.body).toBe('<h1>r</h1>');
      expect(rep.headers['content-security-policy']).toMatch(/^sandbox;/);
      const g = (await app.inject({ url: `${base}/groups/plugin-eval`, headers })).json();
      expect(g.group.id).toBe('plugin-eval');
      expect(g.result.cases[0].runId).toBe('plugin-eval');
      const exp = () => app.inject({ method: 'POST', url: `${base}/export`, headers, payload: { cases: ['basic'] } });
      const first = (await exp()).json().exports[0];
      expect(first).toMatchObject({ case: 'basic', dir: '.plugin-master/exports/evals/basic', written: 1, skipped: 0, total: 1 });
      const index = JSON.parse(await readFile(join(space, first.dir, 'index.json'), 'utf8'));
      expect(index.runs[0].runId).toBe('plugin-eval');
      const file = JSON.parse(await readFile(join(space, first.dir, index.runs[0].file), 'utf8'));
      expect(file.case.name).toBe('basic');
      expect(file.traces).toEqual({});
      // unchanged data: nothing is rewritten
      expect((await exp()).json().exports[0]).toMatchObject({ written: 0, skipped: 1, total: 1 });
      expect((await app.inject({ method: 'POST', url: `${base}/export`, headers, payload: { cases: [] } })).statusCode).toBe(400);
      expect((await app.inject({ url: `${base}/groups/nope`, headers })).statusCode).toBe(404);
      expect((await app.inject({ url: `${base}/runs/..%2Fx`, headers })).statusCode).toBe(400);
      expect((await app.inject({ url: `${base}/runs/nope`, headers })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});