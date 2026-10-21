import type { AddressInfo } from 'node:net';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../app';

let root: string;
let app: ReturnType<typeof buildApp>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pm-watch-'));
  app = buildApp({
    port: 0,
    webOrigins: ['http://localhost:5100'],
    token: 't',
    home: join(root, 'h'),
  });
});
afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

async function connect() {
  const res = await app.inject({
    method: 'POST',
    url: '/api/spaces',
    headers: { authorization: 'Bearer t' },
    payload: { path: join(root, 'plug'), name: 'plug' },
  });
  const space = res.json() as { id: string };
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;
  const ws = new WebSocket(`ws://localhost:${port}/ws?token=t`, {
    headers: { origin: 'http://localhost:5100' },
  });
  const messages: { type: string; path: string; event: string }[] = [];
  ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.once('open', r));
  const send = (m: object) =>
    ws.send(JSON.stringify({ spaceId: space.id, ...m }));
  const changes = () =>
    messages
      .filter((m) => m.type === 'fs.changed')
      .map((m) => `${m.event}:${m.path}`);
  return { ws, send, changes, messages };
}

describe('watcher', () => {
  it('reports only changes in watched paths, not deep unopened files', async () => {
    await mkdir(join(root, 'plug/deep/er'), { recursive: true });
    await writeFile(join(root, 'plug/deep/er/hidden.md'), '');
    const { ws, send, changes } = await connect();
    send({ type: 'subscribe' });
    send({ type: 'fs.watch', paths: ['', 'CLAUDE.md'] });
    await new Promise((r) => setTimeout(r, 500)); // let chokidar settle

    await appendFile(join(root, 'plug/deep/er/hidden.md'), 'x'); // not watched
    await appendFile(join(root, 'plug/CLAUDE.md'), 'x'); // open file
    await writeFile(join(root, 'plug/new.md'), ''); // root dir
    await expect
      .poll(changes, { timeout: 5000 })
      .toEqual(expect.arrayContaining(['change:CLAUDE.md', 'add:new.md']));
    await new Promise((r) => setTimeout(r, 300));
    expect(changes().some((c) => c.includes('hidden.md'))).toBe(false);

    // expanding a dir starts watching its direct children
    send({ type: 'fs.watch', paths: ['', 'deep/er'] });
    await new Promise((r) => setTimeout(r, 500));
    await appendFile(join(root, 'plug/deep/er/hidden.md'), 'y');
    await expect
      .poll(changes, { timeout: 5000 })
      .toContain('change:deep/er/hidden.md');
    ws.close();
  });

  it('still reports add/unlink of a path after it stops being watched', async () => {
    const { ws, send, changes } = await connect();
    await writeFile(join(root, 'plug/a.md'), '');
    send({ type: 'subscribe' });
    send({ type: 'fs.watch', paths: ['', 'a.md'] });
    await new Promise((r) => setTimeout(r, 500));
    send({ type: 'fs.watch', paths: [''] }); // a.md is no longer open
    await new Promise((r) => setTimeout(r, 500));
    await rm(join(root, 'plug/a.md'));
    await expect.poll(changes, { timeout: 5000 }).toContain('unlink:a.md');
    ws.close();
  });

  it('picks up a requested dir that is created after the watch started', async () => {
    const { ws, send, changes } = await connect();
    send({ type: 'subscribe' });
    await mkdir(join(root, 'plug/evals'), { recursive: true });
    send({ type: 'fs.watch', paths: ['', 'evals', 'evals/results'] }); // results/ does not exist yet
    await new Promise((r) => setTimeout(r, 500));
    await mkdir(join(root, 'plug/evals/results'));
    await expect.poll(changes, { timeout: 5000 }).toContain('addDir:evals/results');
    await new Promise((r) => setTimeout(r, 500));
    await mkdir(join(root, 'plug/evals/results/r1'));
    await expect.poll(changes, { timeout: 5000 }).toContain('addDir:evals/results/r1');
    ws.close();
  });

  it('rejects fs.watch for a space the client is not subscribed to', async () => {
    const { ws, send, messages } = await connect();
    send({ type: 'fs.watch', paths: [''] });
    await expect
      .poll(() => messages.some((m) => m.type === 'error'))
      .toBe(true);
    ws.close();
  });

  it('always watches .plugin-master and rejects paths outside the space', async () => {
    const { ws, send, changes, messages } = await connect();
    send({ type: 'subscribe' });
    send({ type: 'fs.watch', paths: ['../etc'] });
    await expect
      .poll(() => messages.some((m) => m.type === 'error'))
      .toBe(true);
    send({ type: 'fs.watch', paths: ['CLAUDE.md'] });
    await new Promise((r) => setTimeout(r, 500));
    await writeFile(join(root, 'plug/.plugin-master/config.json'), '{}');
    await expect
      .poll(changes, { timeout: 5000 })
      .toEqual(
        expect.arrayContaining([
          expect.stringMatching(/\.plugin-master\/config\.json$/),
        ]),
      );
    ws.close();
  });
});
