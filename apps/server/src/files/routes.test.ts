import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';

let root: string;
let app: ReturnType<typeof buildApp>;
let id: string;
const headers = { authorization: 'Bearer t' };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pm-files-routes-'));
  app = buildApp({
    port: 0,
    webOrigins: [],
    token: 't',
    home: join(root, 'h'),
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/spaces',
    headers,
    payload: { path: join(root, 'plug'), name: 'plug' },
  });
  id = res.json().id;
});
afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

describe('files routes', () => {
  it('creates, saves and reads a file', async () => {
    const url = `/api/spaces/${id}/file`;
    const created = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { path: 'skills/foo/SKILL.md', content: 'a' },
    });
    expect(created.statusCode).toBe(201);
    const saved = await app.inject({
      method: 'PUT',
      url,
      headers,
      payload: { path: 'skills/foo/SKILL.md', content: 'b' },
    });
    expect(saved.statusCode).toBe(204);
    expect(await readFile(join(root, 'plug/skills/foo/SKILL.md'), 'utf8')).toBe(
      'b',
    );
    const got = await app.inject({
      url: `${url}?path=skills/foo/SKILL.md`,
      headers,
    });
    expect(got.json()).toEqual({ path: 'skills/foo/SKILL.md', content: 'b' });
    const tree = await app.inject({ url: `/api/spaces/${id}/tree`, headers });
    expect(tree.json().map((n: { name: string }) => n.name)).toContain(
      'skills',
    );
    const sub = await app.inject({
      url: `/api/spaces/${id}/tree?dir=skills/foo`,
      headers,
    });
    expect(sub.json()).toEqual([
      { name: 'SKILL.md', path: 'skills/foo/SKILL.md', type: 'file' },
    ]);
  });

  it('rejects ../ with 400 PATH_OUTSIDE_SPACE', async () => {
    const res = await app.inject({
      url: `/api/spaces/${id}/file?path=../x`,
      headers,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'PATH_OUTSIDE_SPACE' } });
  });
});
