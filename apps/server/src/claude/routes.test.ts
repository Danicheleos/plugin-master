import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildApp } from '../app';

let root: string;
afterEach(() => rm(root, { recursive: true, force: true }));

it('GET /api/spaces/:id/sessions lists sessions of the space path', async () => {
  root = await mkdtemp(join(tmpdir(), 'pm-sess-'));
  const path = join(root, 'plug');
  await mkdir(path);
  const dirs: string[] = [];
  const app = buildApp(
    { port: 0, webOrigins: [], token: 't', home: join(root, 'home') },
    false,
    {
      list: async (dir) => {
        dirs.push(dir);
        return [{ id: 'a', title: 'A', lastModified: 1 }];
      },
      events: async () => [],
      all: async () => [],
    },
  );
  const headers = { authorization: 'Bearer t' };
  const space = (
    await app.inject({
      method: 'POST',
      url: '/api/spaces',
      headers,
      payload: { path, name: 'plug' },
    })
  ).json();
  const res = await app.inject({
    url: `/api/spaces/${space.id}/sessions`,
    headers,
  });
  expect(res.json()).toEqual([{ id: 'a', title: 'A', lastModified: 1 }]);
  expect(dirs).toEqual([path]);
  expect(
    (await app.inject({ url: '/api/spaces/nope/sessions', headers }))
      .statusCode,
  ).toBe(404);
});

it('GET /api/claude/sessions/:id/trace reads the transcript under userHome with the recorded run of a registered space', async () => {
  root = await mkdtemp(join(tmpdir(), 'pm-sess-'));
  const path = join(root, 'plug');
  const id = '11111111-2222-3333-4444-555555555555';
  const run = join(path, '.plugin-master/runs', id);
  await mkdir(run, { recursive: true });
  await writeFile(
    join(run, 'messages.jsonl'),
    JSON.stringify({ type: 'result', num_turns: 1, total_cost_usd: 1 }) + '\n',
  );
  const project = join(root, 'user', '.claude', 'projects', '-plug');
  await mkdir(project, { recursive: true });
  await writeFile(
    join(project, `${id}.jsonl`),
    JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [] } }) +
      '\n',
  );
  const app = buildApp(
    {
      port: 0,
      webOrigins: [],
      token: 't',
      home: join(root, 'home'),
      userHome: join(root, 'user'),
    },
    false,
    { list: async () => [], events: async () => [], all: async () => [] },
  );
  const headers = { authorization: 'Bearer t' };
  await app.inject({
    method: 'POST',
    url: '/api/spaces',
    headers,
    payload: { path, name: 'plug' },
  });
  const res = await app.inject({
    url: `/api/claude/sessions/${id}/trace`,
    headers,
  });
  expect(res.json().metrics).toMatchObject({ costUsd: 1, modelCalls: 1 });
  const other = '22222222-2222-3333-4444-555555555555';
  expect(
    (await app.inject({ url: `/api/claude/sessions/${other}/trace`, headers }))
      .statusCode,
  ).toBe(404);
  await app.close();
});
