import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { PmMetaSchema } from '@pm/protocol';
import { writeSidecar } from './sidecar';

Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
});

let dir: string;
const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
const out = () => join(dir, 'evals/results/r1');
const read = async () => PmMetaSchema.parse(JSON.parse(await readFile(join(out(), 'pm-meta.json'), 'utf8')));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pm-sidecar-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

it('writes nothing outside a repo or without commits', async () => {
  await writeSidecar(dir, 's1', out(), 'now');
  await expect(readFile(join(out(), 'pm-meta.json'))).rejects.toThrow();
  git('init', '-q', '-b', 'main');
  await writeSidecar(dir, 's1', out(), 'now');
  await expect(readFile(join(out(), 'pm-meta.json'))).rejects.toThrow();
});

it('records commit, tree, branch and dirtiness (app state does not count)', async () => {
  git('init', '-q', '-b', 'main');
  await mkdir(join(dir, '.plugin-master'));
  await writeFile(join(dir, '.plugin-master/s.md'), '1');
  await writeFile(join(dir, 'a.txt'), '1');
  git('add', '-A');
  git('commit', '-q', '-m', 'x');
  await writeFile(join(dir, '.plugin-master/s.md'), '2');
  await writeFile(join(dir, 'new.txt'), 'untracked');
  await writeSidecar(dir, 's1', out(), 't0');
  expect(await read()).toEqual({
    commit: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    dirty: false,
    branch: 'main',
    spaceId: 's1',
    startedAt: 't0',
  });
  await writeFile(join(dir, 'a.txt'), '2');
  await writeSidecar(dir, 's1', out(), 't1');
  expect((await read()).dirty).toBe(true);
});
