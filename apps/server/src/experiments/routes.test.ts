import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../app';

Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

let tmp: string;
let path: string;
let home: string;
let app: ReturnType<typeof buildApp>;
let base: string;
const headers = { authorization: 'Bearer t' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  app.inject({ method, url: base + url, headers, payload });
const exp = (url = '', method: 'GET' | 'POST' = 'POST', payload?: object) => call(method, `/experiments${url}`, payload);

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pm-routes-'));
  path = join(tmp, 'plug');
  home = join(tmp, 'home');
  await mkdir(path);
  app = buildApp({ port: 0, webOrigins: [], token: 't', home });
  const space = (await app.inject({ method: 'POST', url: '/api/spaces', headers, payload: { path, name: 'plug' } })).json();
  base = `/api/spaces/${space.id}`;
});
afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

/** Repo with one commit (a.txt, b.txt); the space's own files are ignored so the tree is clean. */
async function repo() {
  await call('PUT', '/features', { git: true, masterLoop: true });
  git(path, 'init', '-q', '-b', 'main');
  git(path, 'config', 'user.name', 't');
  git(path, 'config', 'user.email', 't@t');
  await writeFile(join(path, '.gitignore'), '.plugin-master/\n');
  await writeFile(join(path, 'a.txt'), 'a1\n');
  await writeFile(join(path, 'b.txt'), 'b1\n');
  git(path, 'add', '-A');
  git(path, 'commit', '-q', '-m', 'first');
}
const create = async (hypothesis?: string) => (await exp('', 'POST', hypothesis ? { hypothesis } : {})).json();

it('routes are gated by masterLoop, which needs git', async () => {
  expect((await exp('', 'GET')).statusCode).toBe(409);
  expect((await exp('', 'POST')).json().error.code).toBe('FEATURE_DISABLED');
  expect((await call('PUT', '/features', { masterLoop: true })).statusCode).toBe(400);
});

it('create: worktree outside the space, branch, base = HEAD; n increments', async () => {
  await repo();
  const head = git(path, 'rev-parse', 'HEAD').trim();
  const e = await create('try x');
  expect(e).toMatchObject({ id: 1, branch: 'exp/1', base: head, status: 'created', hypothesis: 'try x' });
  expect(e.worktree).toBe(join(realpathSync(home), 'worktrees', base.split('/').pop()!, 'exp-1'));
  expect(existsSync(join(e.worktree, 'a.txt'))).toBe(true);
  expect(git(path, 'branch', '--list', 'exp/1')).toContain('exp/1');
  expect(JSON.parse(await readFile(join(path, '.plugin-master/experiments/1.json'), 'utf8')).id).toBe(1);
  expect((await create()).id).toBe(2);
  expect((await exp('', 'GET')).json().map((x: { id: number }) => x.id)).toEqual([1, 2]);
  expect((await exp('/1', 'GET')).json().id).toBe(1);
  expect((await exp('/9', 'GET')).statusCode).toBe(404);
  expect((await exp('/1x', 'GET')).statusCode).toBe(400);
  expect((await exp('/-1', 'GET')).statusCode).toBe(400);
});

it('create: not a repo and unborn HEAD are 409', async () => {
  await call('PUT', '/features', { git: true, masterLoop: true });
  expect((await exp()).json().error.code).toBe('NOT_A_REPO');
  git(path, 'init', '-q', '-b', 'main');
  expect((await exp()).json().error.code).toBe('NO_COMMITS');
});

it('diff: committed and uncommitted worktree changes, untracked and deleted files', async () => {
  await repo();
  const e = await create();
  await writeFile(join(e.worktree, 'a.txt'), 'a2\n');
  git(e.worktree, 'config', 'user.name', 't');
  git(e.worktree, 'commit', '-q', '-am', 'edit a');
  await writeFile(join(e.worktree, 'c.txt'), 'c1\n'); // untracked
  await rm(join(e.worktree, 'b.txt')); // uncommitted deletion
  const d = (await exp('/1/diff', 'GET')).json();
  expect(d.files).toEqual([
    { path: 'a.txt', old: 'a1\n', new: 'a2\n' },
    { path: 'b.txt', old: 'b1\n', new: '' },
    { path: 'c.txt', old: '', new: 'c1\n' },
  ]);
});

it('merge: commits the worktree, merges with --no-ff, removes worktree and branch', async () => {
  await repo();
  const e = await create('improve a\nmore');
  await writeFile(join(e.worktree, 'a.txt'), 'a2\n');
  const r = await exp('/1/merge');
  expect(r.json().status).toBe('merged');
  expect(await readFile(join(path, 'a.txt'), 'utf8')).toBe('a2\n');
  expect(existsSync(e.worktree)).toBe(false);
  expect(git(path, 'branch', '--list', 'exp/1')).toBe('');
  expect(git(path, 'log', '--format=%s', '-1', 'HEAD^2')).toBe('exp/1: improve a\n');
  expect(git(path, 'log', '--format=%p', '-1').trim().split(' ')).toHaveLength(2);
  expect((await exp('/1/merge')).json().error.code).toBe('EXPERIMENT_CLOSED');
});

it('merge: refused on a dirty main tree, nothing is lost', async () => {
  await repo();
  const e = await create();
  await writeFile(join(e.worktree, 'a.txt'), 'a2\n');
  await writeFile(join(path, 'b.txt'), 'dirty\n');
  const r = await exp('/1/merge');
  expect(r.statusCode).toBe(409);
  expect(r.json().error.code).toBe('GIT_DIRTY');
  expect(existsSync(e.worktree)).toBe(true);
  expect((await exp('/1', 'GET')).json().status).toBe('created');
});

it('merge: app state under .plugin-master/ does not count as a dirty tree', async () => {
  await repo();
  await writeFile(join(path, '.gitignore'), '');
  git(path, 'commit', '-q', '-am', 'track app state');
  const e = await create(); // untracked .plugin-master/experiments/1.json, config.json
  await writeFile(join(e.worktree, 'a.txt'), 'a2\n');
  expect((await exp('/1/merge')).json().status).toBe('merged');
  expect(await readFile(join(path, 'a.txt'), 'utf8')).toBe('a2\n');
});

it('merge: untracked files in the main tree (eval results) do not block it and stay', async () => {
  await repo();
  const e = await create();
  await writeFile(join(e.worktree, 'a.txt'), 'a2\n');
  await mkdir(join(path, 'evals', 'results'), { recursive: true });
  await writeFile(join(path, 'evals', 'results', 'x.json'), '{}');
  expect((await exp('/1/merge')).json().status).toBe('merged');
  expect(await readFile(join(path, 'a.txt'), 'utf8')).toBe('a2\n');
  expect(await readFile(join(path, 'evals', 'results', 'x.json'), 'utf8')).toBe('{}');
});

it('merge: an untracked main file the experiment adds is a clean 409, nothing changes', async () => {
  await repo();
  const e = await create();
  await writeFile(join(e.worktree, 'new.txt'), 'theirs\n');
  await writeFile(join(path, 'new.txt'), 'mine\n');
  const head = git(path, 'rev-parse', 'HEAD');
  const r = await exp('/1/merge');
  expect(r.statusCode).toBe(409);
  expect(r.json().error.code).toBe('GIT_CONFLICT');
  expect(r.json().error.message).toContain('Untracked files in the main tree would be overwritten by the merge: new.txt');
  expect(git(path, 'rev-parse', 'HEAD')).toBe(head);
  expect(existsSync(join(path, '.git', 'MERGE_HEAD'))).toBe(false);
  expect(git(path, 'status', '--porcelain')).toBe('?? new.txt\n');
  expect(await readFile(join(path, 'new.txt'), 'utf8')).toBe('mine\n');
  expect(existsSync(e.worktree)).toBe(true);
  expect((await exp('/1', 'GET')).json().status).toBe('created');
});

it('merge: a conflict is aborted, the main tree is unchanged', async () => {
  await repo();
  const e = await create();
  await writeFile(join(e.worktree, 'a.txt'), 'theirs\n');
  await writeFile(join(path, 'a.txt'), 'ours\n');
  git(path, 'commit', '-q', '-am', 'ours');
  const head = git(path, 'rev-parse', 'HEAD');
  const r = await exp('/1/merge');
  expect(r.statusCode).toBe(409);
  expect(r.json()).toMatchObject({ error: { code: 'GIT_CONFLICT' } });
  expect(r.json().error.message).toContain('a.txt');
  expect(git(path, 'status', '--porcelain')).toBe('');
  expect(git(path, 'rev-parse', 'HEAD')).toBe(head);
  expect(await readFile(join(path, 'a.txt'), 'utf8')).toBe('ours\n');
  expect(existsSync(e.worktree)).toBe(true);
  expect((await exp('/1', 'GET')).json().status).toBe('created');
});

it('discard: removes worktree and branch', async () => {
  await repo();
  const e = await create();
  await writeFile(join(e.worktree, 'a.txt'), 'wip\n');
  expect((await exp('/1/discard')).json().status).toBe('discarded');
  expect(existsSync(e.worktree)).toBe(false);
  expect(git(path, 'branch', '--list', 'exp/1')).toBe('');
  expect(git(path, 'worktree', 'list')).not.toContain(e.worktree);
  expect((await exp('/1/discard')).json().error.code).toBe('EXPERIMENT_CLOSED');
  expect((await create()).id).toBe(2);
});

it('discard refuses a worktree path outside the worktrees dir', async () => {
  await repo();
  await create();
  const victim = join(tmp, 'victim');
  await mkdir(victim);
  await writeFile(join(victim, 'keep.txt'), 'x');
  const file = join(path, '.plugin-master/experiments/1.json');
  const rec = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...rec, worktree: victim }));
  const r = await exp('/1/discard');
  expect(r.statusCode).toBe(400);
  expect(existsSync(join(victim, 'keep.txt'))).toBe(true);
  expect(git(path, 'branch', '--list', 'exp/1')).toContain('exp/1');
});
