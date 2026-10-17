import type { AddressInfo } from 'node:net';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    webOrigins: ['http://localhost:4200'],
    token: 't',
    home: join(root, 'h'),
  });
});
afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

describe('watcher', () => {
  it('broadcasts fs.changed with relative paths to subscribers', async () => {
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
      headers: { origin: 'http://localhost:4200' },
    });
    const messages: { path: string; event: string }[] = [];
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'subscribe', spaceId: space.id }));
    await new Promise((r) => setTimeout(r, 500)); // let chokidar finish its initial scan

    await appendFile(join(root, 'plug/CLAUDE.md'), 'x');
    await writeFile(join(root, 'plug/new.md'), '');
    await expect
      .poll(() => messages.map((m) => `${m.event}:${m.path}`), {
        timeout: 5000,
      })
      .toEqual(expect.arrayContaining(['change:CLAUDE.md', 'add:new.md']));
    ws.close();
  });
});
