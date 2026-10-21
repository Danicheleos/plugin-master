import { mkdtemp, mkdir, rm } from 'node:fs/promises';
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
      trace: async () => undefined,
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
