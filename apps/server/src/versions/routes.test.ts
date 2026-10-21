import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { VersionsCompare, VersionsGate, VersionsResponse } from '@pm/protocol';
import { buildApp } from '../app';

Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
});

let tmp: string;
let path: string;
let app: ReturnType<typeof buildApp>;
let base: string;
const headers = { authorization: 'Bearer t' };
const git = (...a: string[]) => execFileSync('git', a, { cwd: path, encoding: 'utf8' }).trim();
const write = async (rel: string, text: string) => {
  await mkdir(dirname(join(path, rel)), { recursive: true });
  await writeFile(join(path, rel), text);
};
const get = (url: string) => app.inject({ method: 'GET', url: base + url, headers });

const skill = (body: string) => `---\nname: x\ndescription: short\n---\n${body}\n`;

/** Minimal aggregate-result.json: `cases` = [name, score, passed]. */
function result(startedAt: string, cases: [string, number, boolean][], partial = false) {
  const score = cases.reduce((n, c) => n + c[1], 0) / cases.length;
  return JSON.stringify({
    schemaVersion: 1,
    startedAt,
    durationSeconds: 1,
    partial,
    suite: { ablation: 'none', plugins: [{ name: 'p' }] },
    cases: cases.map(([name, s, passed]) => ({
      name,
      arms: { with: [{ score: s, passed, costUsd: 0.1 }], without: [] },
      aggregates: { score: s },
    })),
    aggregates: { overallScore: score, casesTotal: cases.length, casesPassed: cases.filter((c) => c[2]).length },
  });
}
const run = async (id: string, startedAt: string, cases: [string, number, boolean][], commit?: string, partial = false) => {
  await write(`evals/results/${id}/aggregate-result.json`, result(startedAt, cases, partial));
  if (commit)
    await write(
      `evals/results/${id}/pm-meta.json`,
      JSON.stringify({ commit, tree: git('rev-parse', `${commit}^{tree}`), dirty: false, spaceId: 's', startedAt }),
    );
};

let c1: string;
let c2: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pm-versions-'));
  path = join(tmp, 'plug');
  await mkdir(path);
  app = buildApp({ port: 0, webOrigins: [], token: 't', home: join(tmp, 'home') });
  const space = (await app.inject({ method: 'POST', url: '/api/spaces', headers, payload: { path, name: 'plug' } })).json();
  base = `/api/spaces/${space.id}`;
});
afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

async function fixture() {
  await app.inject({ method: 'PUT', url: `${base}/features`, headers, payload: { git: true } });
  git('init', '-q', '-b', 'main');
  await write('skills/x/SKILL.md', skill('body'));
  await write('evals/cases/h/prompt.md', '---\ntags: [holdout]\n---\nhi\n');
  await write('evals/.gitignore', 'results/\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'first');
  c1 = git('rev-parse', 'HEAD');
  await write('skills/x/SKILL.md', skill('a longer body than before'));
  git('commit', '-q', '-am', 'second');
  c2 = git('rev-parse', 'HEAD');
  await run('r1', '2026-01-01T10:00:00.000Z', [['a', 0.5, false], ['h', 1, true]], c1);
  await run('r2', '2099-01-01T10:00:00.000Z', [['a', 0.8, true], ['h', 1, true]]); // no sidecar: by time
}

it('is gated by the git feature and needs a repo', async () => {
  expect((await get('/versions')).statusCode).toBe(409);
  await app.inject({ method: 'PUT', url: `${base}/features`, headers, payload: { git: true } });
  expect((await get('/versions')).json().error.code).toBe('NOT_A_REPO');
});

it('lists commits with eval scores, trend delta and approx flags', async () => {
  await fixture();
  await run('r3', '2026-01-01T11:00:00.000Z', [['a', 0.1, false]], c1, true); // partial: never a trend point
  const { commits } = (await get('/versions?limit=10')).json() as VersionsResponse;
  expect(commits.map((c) => c.hash)).toEqual([c2, c1]);
  expect(commits[1]).toMatchObject({ trendable: true, eval: { score: 0.75, runIds: ['r1'] } });
  expect(commits[1].eval?.approx).toBeUndefined();
  expect(commits[0]).toMatchObject({ trendable: true, eval: { score: 0.9, approx: true } });
  expect(commits[0].delta).toBeCloseTo(0.15);
  expect((await get('/versions?limit=1')).json().commits).toHaveLength(1);
  expect((await get('/versions?limit=0')).statusCode).toBe(400);
});

it('compares versions: files, cases, skill context; gate fails on growth', async () => {
  await fixture();
  const cmp = (await get(`/versions/compare?from=${c1}&to=HEAD`)).json() as VersionsCompare;
  expect(cmp.files).toEqual([{ status: 'M', path: 'skills/x/SKILL.md' }]);
  expect(cmp.cases.map((c) => [c.name, c.delta === undefined ? undefined : Math.round(c.delta * 100) / 100])).toEqual([['a', 0.3], ['h', 0]]);
  expect(cmp.cases[0].to).toMatchObject({ runId: 'r2', arm: 'with', n: 1, passed: true, costUsd: 0.1 });
  expect(cmp.skillContext.toBytes).toBeGreaterThan(cmp.skillContext.fromBytes);
  expect(cmp.to.approx).toBe(true);

  const gate = (await get(`/versions/gate?from=${c1}&to=${c2}`)).json() as VersionsGate;
  expect(gate.rules.map((r) => [r.id, r.status])).toEqual([
    ['no-regression', 'pass'],
    ['ctx-not-grown', 'fail'],
    ['holdout-pass', 'pass'],
  ]);
  expect(gate.status).toBe('fail');
  expect(gate.warnings).toHaveLength(2); // approx + inconclusive (2 cases)
  expect(gate.suite.verdict).toBe('inconclusive');
  expect(cmp.suite.cases).toBe(2);
});

it('a commit that lost its time-mapped runs has no data: unknown, never pass', async () => {
  await fixture();
  const gate = (await get(`/versions/gate?from=${c2}&to=${c2}`)).json() as VersionsGate;
  expect(gate.rules.find((r) => r.id === 'no-regression')?.status).toBe('pass'); // same data, delta 0
  await write('x.txt', 'x');
  git('add', '-A');
  git('commit', '-q', '-m', 'third'); // time-mapped runs (2099) belong to the newest commit only
  const c3 = git('rev-parse', 'HEAD');
  const g2 = (await get(`/versions/gate?from=${c1}&to=${c3}`)).json() as VersionsGate;
  expect(g2.rules.map((r) => r.status)).toEqual(['pass', 'fail', 'pass']); // skill still larger than at c1
  const g3 = (await get(`/versions/gate?from=${c1}&to=${c2}`)).json() as VersionsGate;
  expect(g3.rules.find((r) => r.id === 'holdout-pass')?.status).toBe('unknown'); // c2 lost its approximate run
});

it('rejects bad refs', async () => {
  await fixture();
  for (const ref of ['--output=x', '-h', 'nope', 'a b', '', 'HEAD;ls'])
    expect((await get(`/versions/compare?from=${encodeURIComponent(ref)}&to=HEAD`)).statusCode, ref).toBe(400);
  expect((await get('/versions/compare?from=HEAD')).statusCode).toBe(400);
  expect((await get('/versions/compare?from=HEAD~1&to=HEAD')).statusCode).toBe(200);
});
