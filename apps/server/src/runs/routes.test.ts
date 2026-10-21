import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildApp } from '../app';

let tmp: string;
afterEach(() => rm(tmp, { recursive: true, force: true }));

it('lists runs newest first and serves a run trace', async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pm-runs-'));
  const path = join(tmp, 'plug');
  await mkdir(path);
  const app = buildApp({ port: 0, webOrigins: [], token: 't', home: join(tmp, 'home') });
  const headers = { authorization: 'Bearer t' };
  const space = (
    await app.inject({ method: 'POST', url: '/api/spaces', headers, payload: { path, name: 'plug' } })
  ).json();
  const run = async (id: string, meta: string | null, age: number) => {
    const d = join(path, '.plugin-master/runs', id);
    await mkdir(d, { recursive: true });
    if (meta) await writeFile(join(d, 'meta.json'), meta);
    const f = join(d, 'messages.jsonl');
    await writeFile(
      f,
      [
        { type: 'user', message: { role: 'user', content: 'hi there' }, parent_tool_use_id: null },
        { type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: 'yo' }], usage: { input_tokens: 5, output_tokens: 1 } } },
      ]
        .map((m) => JSON.stringify(m))
        .join('\n') + '\n',
    );
    const t = new Date(Date.now() - age);
    await utimes(f, t, t);
  };
  const meta = (id: string) =>
    JSON.stringify({ id, title: id, startedAt: 'a', endedAt: 'b', turns: 1, costUsd: 0, models: [] });
  await run('old', meta('old'), 5000);
  await run('new', meta('new'), 1000);
  await run('bad', '{nope', 3000);
  const list = (await app.inject({ url: `/api/spaces/${space.id}/runs`, headers })).json();
  expect(list.runs.map((r: { id: string }) => r.id)).toEqual(['new', 'bad', 'old']);
  expect(list.runs[1].error).toBeTruthy();
  const trace = (await app.inject({ url: `/api/spaces/${space.id}/runs/new/trace`, headers })).json();
  expect(trace.prompt).toBe('hi there');
  expect(trace.turns).toHaveLength(1);
  for (const bad of ['..%2fx', 'a%2fb', '..', 'a.b'])
    expect((await app.inject({ url: `/api/spaces/${space.id}/runs/${bad}/trace`, headers })).statusCode).toBeGreaterThanOrEqual(400);
  const missing = await app.inject({ url: `/api/spaces/${space.id}/runs/nope/trace`, headers });
  expect(missing.statusCode).toBe(404);
  expect(missing.json().error.code).toBe('RUN_NOT_FOUND');
  const empty = await app.inject({ url: `/api/spaces/${space.id}/runs`, headers: { authorization: 'Bearer t' } });
  expect(empty.statusCode).toBe(200);
  await app.close();
});
