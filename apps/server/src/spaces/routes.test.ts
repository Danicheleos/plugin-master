import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';

let root: string;
let app: ReturnType<typeof buildApp>;
const headers = { authorization: 'Bearer t' };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pm-routes-'));
  app = buildApp({
    port: 0,
    webOrigins: [],
    token: 't',
    home: join(root, 'home'),
  });
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('spaces routes', () => {
  it('POST /api/spaces creates a space and scaffolds the folder', async () => {
    const path = join(root, 'plug');
    const res = await app.inject({
      method: 'POST',
      url: '/api/spaces',
      headers,
      payload: { path, name: 'plug' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'plug', path });
    await expect(
      readFile(join(path, '.claude-plugin/plugin.json')),
    ).resolves.toBeDefined();
    expect(
      (await app.inject({ url: '/api/spaces', headers })).json(),
    ).toHaveLength(1);
  });

  it('POST /api/spaces/open on a plain folder returns 422 NOT_A_PLUGIN', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/spaces/open',
      headers,
      payload: { path: root },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_A_PLUGIN' } });
  });

  it('POST /api/spaces with an invalid name returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/spaces',
      headers,
      payload: { path: root, name: 'Bad Name' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});
