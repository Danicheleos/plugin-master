import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FeaturesSchema } from '@pm/protocol';
import { buildApp } from '../app';

// no dependence on the developer's git config
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
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: path, encoding: 'utf8' });
const write = (rel: string, text: string | Buffer) => writeFile(join(path, rel), text);
const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  app.inject({ method, url: base + url, headers, payload });
const features = (f: object) => call('PUT', '/features', f);

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pm-git-'));
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

/** Enables git and makes a repo with one commit of a.txt, b.txt. */
async function repo() {
  await features({ git: true });
  git('init', '-q', '-b', 'main');
  await write('a.txt', 'a1\n');
  await write('b.txt', 'b1\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'first');
}

it('features: defaults off, partial update, autoCommit needs git', async () => {
  expect((await call('GET', '/features')).json()).toEqual(FeaturesSchema.parse({}));
  expect((await features({ autoCommit: true })).statusCode).toBe(400);
  expect((await features({ git: true, autoCommit: true, junk: 1 })).json()).toEqual({ git: true, autoCommit: true, masterLoop: false, userSettings: false });
  expect((await features({ git: false, autoCommit: true })).statusCode).toBe(400);
  expect((await features({ masterLoop: true })).json()).toMatchObject({ masterLoop: true });
  expect((await features({ git: false })).json()).toEqual({ git: false, autoCommit: false, masterLoop: false, userSettings: false }); // dependents follow
  await features({ git: true, autoCommit: true });
  const cfg = JSON.parse(await readFile(join(path, '.plugin-master/config.json'), 'utf8'));
  expect(cfg.features).toEqual({ git: true, autoCommit: true, masterLoop: false, userSettings: false }); // unknown keys are dropped
  expect(cfg.masterContext).toBeDefined();
  // an old config.json that still has the removed `terminal` flag parses
  cfg.features.terminal = true;
  await writeFile(join(path, '.plugin-master/config.json'), JSON.stringify(cfg));
  expect((await call('GET', '/features')).json()).toEqual({ git: true, autoCommit: true, masterLoop: false, userSettings: false });
});

it('every git route is 409 FEATURE_DISABLED when off', async () => {
  const routes: [Parameters<typeof call>[0], string, object?][] = [
    ['GET', '/git/status'],
    ['POST', '/git/init'],
    ['GET', '/git/diff?path=a'],
    ['GET', '/git/log'],
    ['GET', '/git/branches'],
    ['POST', '/git/commit', { message: 'm' }],
    ['POST', '/git/branch', { name: 'x' }],
    ['POST', '/git/switch', { name: 'x' }],
  ];
  for (const [m, u, p] of routes) {
    const res = await call(m, u, p);
    expect([u, res.statusCode, res.json().error.code]).toEqual([u, 409, 'FEATURE_DISABLED']);
  }
});

it('not a repo: status is isRepo false, init creates it', async () => {
  await features({ git: true });
  expect((await call('GET', '/git/status')).json()).toEqual({ isRepo: false });
  expect((await call('GET', '/git/log')).json().error.code).toBe('NOT_A_REPO');
  const res = await call('POST', '/git/init');
  expect(res.json()).toMatchObject({ isRepo: true, files: expect.any(Array) });
});

it('status lists modified, new, deleted files', async () => {
  await repo();
  await write('a.txt', 'a2\n');
  await write('c.txt', 'c\n');
  git('rm', '-q', '-f', 'b.txt');
  const s = (await call('GET', '/git/status')).json();
  expect(s.branch).toBe('main');
  expect(s.ahead).toBeUndefined();
  const by = Object.fromEntries(s.files.map((f: { path: string }) => [f.path, f]));
  expect(by['a.txt']).toMatchObject({ index: ' ', workingDir: 'M' });
  expect(by['c.txt']).toMatchObject({ index: '?', workingDir: '?' });
  expect(by['b.txt']).toMatchObject({ index: 'D' });
});

it('diff: modified, new, deleted, binary, too large, bad path', async () => {
  await repo();
  await write('a.txt', 'a2\n');
  await write('c.txt', 'c\n');
  await write('bin.dat', Buffer.from([0, 1, 2]));
  await rm(join(path, 'b.txt'));
  const diff = async (p: string) => (await call('GET', `/git/diff?path=${encodeURIComponent(p)}`)).json();
  expect(await diff('a.txt')).toEqual({ path: 'a.txt', old: 'a1\n', new: 'a2\n' });
  expect(await diff('c.txt')).toEqual({ path: 'c.txt', old: '', new: 'c\n' });
  expect(await diff('b.txt')).toEqual({ path: 'b.txt', old: 'b1\n', new: '' });
  expect(await diff('bin.dat')).toMatchObject({ binary: true });
  await write('big.txt', 'x'.repeat(1024 * 1024 + 1));
  expect(await diff('big.txt')).toMatchObject({ tooLarge: true });
  expect((await call('GET', '/git/diff?path=../x')).statusCode).toBe(400);
  expect((await call('GET', '/git/diff')).statusCode).toBe(400);
});

it('log: newest first, limit', async () => {
  await repo();
  await write('a.txt', 'a2\n');
  git('commit', '-q', '-am', 'second');
  const log = (await call('GET', '/git/log')).json();
  expect(log.map((c: { message: string }) => c.message)).toEqual(['second', 'first']);
  expect(log[0]).toMatchObject({ author: 't', hash: expect.stringMatching(/^[0-9a-f]{40}$/) });
  expect((await call('GET', '/git/log?limit=1')).json()).toHaveLength(1);
});

it('commit: selected paths vs all, empty message, nothing to commit', async () => {
  await repo();
  await write('a.txt', 'a2\n');
  await write('c.txt', 'c\n');
  expect((await call('POST', '/git/commit', { message: '  ' })).statusCode).toBe(400);
  expect((await call('POST', '/git/commit', { message: 'm', paths: ['../x'] })).statusCode).toBe(400);
  const one = (await call('POST', '/git/commit', { message: 'only c', paths: ['c.txt'] })).json();
  expect(one.hash).toBe(git('rev-parse', 'HEAD').trim());
  expect(git('show', '--name-only', '--format=', 'HEAD').trim()).toBe('c.txt');
  expect(git('status', '--porcelain').trim()).toBe('M a.txt');
  expect((await call('POST', '/git/commit', { message: 'all' })).statusCode).toBe(200);
  expect(git('status', '--porcelain').trim()).toBe('');
  expect((await call('POST', '/git/commit', { message: 'again' })).json().error.code).toBe('NOTHING_TO_COMMIT');
});

it('selective commit leaves unrelated files (staged or not) out', async () => {
  await repo();
  await write('a.txt', 'a2\n');
  await write('b.txt', 'b2\n');
  await write('c.txt', 'c\n');
  git('add', 'b.txt'); // already staged, unrelated
  await call('POST', '/git/commit', { message: 'only c', paths: ['c.txt'] });
  expect(git('show', '--name-only', '--format=', 'HEAD').trim()).toBe('c.txt');
  expect(git('status', '--porcelain').split('\n').filter(Boolean).sort()).toEqual([' M a.txt', 'M  b.txt']);
});

it('paths are literal names, not globs', async () => {
  await repo();
  await write('[ab].md', 'x');
  await write('a.md', 'a');
  await write('b.md', 'b');
  await call('POST', '/git/commit', { message: 'glob', paths: ['[ab].md'] });
  expect(git('show', '--name-only', '--format=', 'HEAD').trim()).toBe('[ab].md');
  expect(git('status', '--porcelain').split('\n').filter(Boolean).sort()).toEqual(['?? a.md', '?? b.md']);
});

it('a renamed entry committed with both paths leaves no staged deletion', async () => {
  await repo();
  git('mv', 'a.txt', 'c.txt');
  const status = (await call('GET', '/git/status')).json();
  expect(status.files).toEqual([{ path: 'c.txt', from: 'a.txt', index: 'R', workingDir: ' ' }]);
  await call('POST', '/git/commit', { message: 'rename', paths: ['c.txt', 'a.txt'] });
  expect(git('show', '--name-status', '--format=', 'HEAD').trim()).toBe('R100\ta.txt\tc.txt');
  expect(git('status', '--porcelain').trim()).toBe('');
});

it('a failing hook without stderr output is an error, not a fake commit', async () => {
  await repo();
  await write('.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n');
  await chmod(join(path, '.git/hooks/pre-commit'), 0o755);
  await write('a.txt', 'a2\n');
  const before = git('rev-parse', 'HEAD');
  const res = await call('POST', '/git/commit', { message: 'm' });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toMatchObject({ code: 'GIT_ERROR', message: expect.stringContaining('exited 1') });
  expect(git('rev-parse', 'HEAD')).toBe(before);
});

it('log of a repo without commits is empty', async () => {
  await features({ git: true });
  git('init', '-q', '-b', 'main');
  expect((await call('GET', '/git/log')).json()).toEqual([]);
});

it('branch and switch: create, dirty refuses, carry keeps the change, bad names', async () => {
  await repo();
  expect((await call('POST', '/git/branch', { name: 'dev' })).statusCode).toBe(200);
  expect((await call('GET', '/git/branches')).json()).toEqual({ current: 'main', local: ['dev', 'main'] });
  for (const name of ['-x', '--orphan', 'a..b', 'a b', 'x.lock/', ''])
    expect([name, (await call('POST', '/git/branch', { name })).statusCode]).toEqual([name, 400]);
  expect((await call('POST', '/git/branch', { name: 'ok', from: '-x' })).statusCode).toBe(400);
  expect((await call('POST', '/git/switch', { name: '-c' })).statusCode).toBe(400);
  expect((await call('POST', '/git/branch', { name: 'dev' })).json().error.code).toBe('GIT_ERROR'); // exists

  await write('a.txt', 'dirty\n');
  const dirty = await call('POST', '/git/switch', { name: 'dev' });
  expect([dirty.statusCode, dirty.json().error.code]).toEqual([409, 'GIT_DIRTY']);
  const res = await call('POST', '/git/switch', { name: 'dev', carry: true });
  expect(res.json().branch).toBe('dev');
  expect(await readFile(join(path, 'a.txt'), 'utf8')).toBe('dirty\n');

  // a conflicting change is refused by git, never discarded
  git('commit', '-q', '-am', 'on dev');
  await call('POST', '/git/switch', { name: 'main' });
  await write('a.txt', 'conflict\n');
  const bad = await call('POST', '/git/switch', { name: 'dev', carry: true });
  expect([bad.statusCode, bad.json().error.code]).toEqual([409, 'GIT_ERROR']);
  expect(await readFile(join(path, 'a.txt'), 'utf8')).toBe('conflict\n');
});
