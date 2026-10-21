import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { createRecorder, gitHead } from './recorder';

let root: string;
const tmp = async () => (root = await mkdtemp(join(tmpdir(), 'pm-rec-')));
afterEach(() => rm(root, { recursive: true, force: true }));
const dir = (id: string) => join(root, '.plugin-master/runs', id);
const lines = async (id: string) =>
  (await readFile(join(dir(id), 'messages.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
const meta = async (id: string) =>
  JSON.parse(await readFile(join(dir(id), 'meta.json'), 'utf8'));
const init = (sid: string) => ({
  type: 'system',
  subtype: 'init',
  session_id: sid,
  model: 'm1',
  claude_code_version: '2.0.1',
});
const result = (sid: string, cost: number) => ({
  type: 'result',
  session_id: sid,
  num_turns: 2,
  total_cost_usd: cost,
});
// the writer's chain is private, so tests poll the files (`vi.waitFor`) instead of sleeping
const rec = (
  onError = vi.fn(),
  head: () => Promise<string | undefined> = async () => 'abc123',
) => ({
  onError,
  r: createRecorder(onError, head),
});

it('buffers the prompt until the session id is known and appends across turns', async () => {
  await tmp();
  const { r, onError } = rec();
  const w = r.start(root);
  w.user('  first\n prompt ' + 'x'.repeat(200));
  w.message(init('s1'));
  w.message(result('s1', 0.5));
  w.user('second');
  w.message(result('s1', 0.75));
  await vi.waitFor(async () => expect((await meta('s1')).costUsd).toBe(0.75));
  const l = await lines('s1');
  expect(l.map((m) => m.type)).toEqual([
    'user',
    'system',
    'result',
    'user',
    'result',
  ]);
  const m = await meta('s1');
  expect(m).toMatchObject({
    id: 's1',
    turns: 4,
    costUsd: 0.75,
    models: ['m1'],
    claudeVersion: '2.0.1',
    commit: 'abc123',
  });
  expect(m.title.length).toBeLessThanOrEqual(81);
  expect(m.title.startsWith('first prompt')).toBe(true);
  expect(onError).not.toHaveBeenCalled();
});

it('resume with the same id continues the run; a new id records resumedFrom', async () => {
  await tmp();
  const { r } = rec();
  const a = r.start(root);
  a.user('hello');
  a.message(init('s1'));
  a.message(result('s1', 1));
  await vi.waitFor(async () => expect((await meta('s1')).costUsd).toBe(1));
  const b = r.start(root, 's1');
  b.user('again');
  b.message(init('s1'));
  b.message(result('s1', 0.5));
  const c = r.start(root, 's1');
  c.message(init('s2'));
  await vi.waitFor(async () => {
    expect((await lines('s1')).length).toBe(6);
  });
  expect(await meta('s1')).toMatchObject({
    title: 'hello',
    turns: 4,
    costUsd: 1.5,
  });
  expect((await meta('s1')).resumedFrom).toBeUndefined();
  expect(await meta('s2')).toMatchObject({ resumedFrom: 's1' });
});

it('omits commit outside a git repo and records HEAD inside one', async () => {
  await tmp();
  expect(await gitHead(root)).toBeUndefined();
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '--allow-empty',
      '-qm',
      'x',
    ],
    { cwd: root },
  );
  const sha = await gitHead(root);
  expect(sha).toMatch(/^[0-9a-f]{40}$/);
  const w = createRecorder(vi.fn()).start(root);
  w.message(init('g1'));
  await vi.waitFor(async () => {
    expect((await meta('g1')).commit).toBe(sha);
  });
  const { r } = rec(vi.fn(), async () => undefined);
  r.start(root).message(init('g2'));
  await vi.waitFor(async () => {
    expect('commit' in (await meta('g2'))).toBe(false);
  });
});

it('swallows write failures', async () => {
  await tmp();
  await mkdir(join(root, '.plugin-master'));
  await writeFile(join(root, '.plugin-master/runs'), 'not a dir');
  const { r, onError } = rec();
  const w = r.start(root);
  w.message(init('f1'));
  w.message(result('f1', 1));
  await vi.waitFor(async () => {
    expect(onError).toHaveBeenCalled();
  });
});
