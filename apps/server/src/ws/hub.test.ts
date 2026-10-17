import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../app';
import type { Config } from '../config';
import { createHub } from './hub';

const config: Config = {
  port: 0,
  webOrigins: ['http://localhost:4200'],
  token: 'secret',
  home: '/nonexistent-pm-home',
};
const origin = 'http://localhost:4200';

const open = (url: string, headers?: Record<string, string>) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (req, res) => {
      req.destroy();
      reject(new Error(`HTTP ${res.statusCode}`));
    });
  });
const next = (ws: WebSocket) =>
  new Promise<unknown>((resolve) =>
    ws.once('message', (d) => resolve(JSON.parse(d.toString()))),
  );

const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function listen(app: ReturnType<typeof Fastify>) {
  apps.push(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  return `ws://localhost:${(app.server.address() as AddressInfo).port}`;
}

describe('ws guard', () => {
  it('rejects a connection without a valid token or Origin and accepts a valid one', async () => {
    const base = await listen(buildApp(config));
    await expect(open(`${base}/ws?token=secret`)).rejects.toThrow(); // no Origin
    await expect(open(`${base}/ws?token=wrong`, { origin })).rejects.toThrow(
      '401',
    );
    await expect(open(`${base}/ws`, { origin })).rejects.toThrow('401');
    await expect(
      open(`${base}/ws?token=secret`, { origin: 'http://evil.com' }),
    ).rejects.toThrow('403');
    const ws = await open(`${base}/ws?token=secret`, { origin });
    ws.close();
  });

  it('percent-encoded paths cannot bypass the check', async () => {
    const base = await listen(buildApp(config));
    await expect(open(`${base}/%77s`, { origin })).rejects.toThrow();
    await expect(open(`${base}/%77s?token=secret`)).rejects.toThrow();
    const ws = await open(`${base}/%77s?token=secret`, { origin });
    ws.close();
  });
});

describe('hub', () => {
  it('broadcast reaches only subscribers of that space; bad messages get an error', async () => {
    const hub = createHub(config);
    const app = Fastify();
    app.register(websocket);
    app.register(hub.plugin);
    const base = await listen(app);
    const url = `${base}/ws?token=secret`;
    const [a, b] = await Promise.all([
      open(url, { origin }),
      open(url, { origin }),
    ]);
    const received: string[] = [];
    b.on('message', () => received.push('b'));
    const subscribed = new Promise<void>((r) => hub.onSubscribe(() => r()));
    a.send(JSON.stringify({ type: 'subscribe', spaceId: 's1' }));
    await subscribed;
    const got = next(a);
    hub.broadcast('s1', {
      type: 'fs.changed',
      spaceId: 's1',
      path: 'x',
      event: 'add',
    });
    expect(await got).toMatchObject({ type: 'fs.changed', path: 'x' });

    const err = next(b);
    b.send('not json');
    expect(await err).toMatchObject({ type: 'error' });
    expect(received).toEqual(['b']); // only the error, never the broadcast
    a.close();
    b.close();
  });
});
