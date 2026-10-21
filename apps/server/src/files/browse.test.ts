import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';

let root: string;
let app: ReturnType<typeof buildApp>;
const headers = { authorization: 'Bearer t' };
const browse = (path?: string) =>
  app.inject({
    url: '/api/fs/browse' + (path ? `?path=${encodeURIComponent(path)}` : ''),
    headers,
  });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pm-browse-'));
  for (const d of ['b', 'a', '.hidden']) await mkdir(join(root, d));
  await writeFile(join(root, 'file.txt'), '');
  app = buildApp({
    port: 0,
    webOrigins: [],
    token: 't',
    home: join(root, 'home'),
    userHome: root,
  });
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('GET /api/fs/browse', () => {
  it('defaults to the user home and lists sorted visible subdirectories', async () => {
    const res = await browse();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      path: root,
      parent: dirname(root),
      entries: [{ name: 'a' }, { name: 'b' }],
    });
  });

  it('requires the token', async () => {
    const res = await app.inject({ url: '/api/fs/browse' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects relative paths with 400', async () => {
    expect((await browse('a/b')).statusCode).toBe(400);
  });

  it('returns 404 for missing paths and files', async () => {
    expect((await browse(join(root, 'nope'))).statusCode).toBe(404);
    expect((await browse(join(root, 'file.txt'))).statusCode).toBe(404);
  });

  it('has a null parent at the filesystem root', async () => {
    expect((await browse('/')).json().parent).toBeNull();
  });
});
