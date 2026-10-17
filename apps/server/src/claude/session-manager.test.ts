import websocket from '@fastify/websocket';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ServerMessage } from '@pm/protocol';
import Fastify from 'fastify';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { Config } from '../config';
import { createRegistry } from '../spaces/registry';
import { createHub } from '../ws/hub';
import type { SessionOptions } from './session';
import { createSessionManager } from './session-manager';

const origin = 'http://localhost:4200';
const asMsg = (m: unknown) => m as SDKMessage;
const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function setup(masterContext: string[] = []) {
  const home = await mkdtemp(join(tmpdir(), 'pm-chat-'));
  await mkdir(join(home, '.plugin-master'));
  await writeFile(join(home, 'IDEA.md'), 'CODENAME-X');
  await writeFile(
    join(home, '.plugin-master/config.json'),
    JSON.stringify({ masterContext }),
  );
  const config: Config = { port: 0, webOrigins: [origin], token: 't', home };
  const registry = createRegistry(home);
  await registry.add({ id: 's1', name: 'p', path: home, createdAt: '' });
  const hub = createHub(config);
  const sessions: {
    o: SessionOptions;
    texts: string[];
    closed: boolean;
    interrupted: number;
  }[] = [];
  createSessionManager(hub, registry, (o) => {
    const s = { o, texts: [] as string[], closed: false, interrupted: 0 };
    sessions.push(s);
    return {
      send: (t) => void s.texts.push(t),
      interrupt: async () => void s.interrupted++,
      close: () => void (s.closed = true),
    };
  });
  const app = Fastify();
  apps.push(app);
  await app.register(websocket);
  await app.register(hub.plugin);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;

  async function client() {
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=t`, {
      headers: { origin },
    });
    const msgs: ServerMessage[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once('open', r));
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    return { ws, msgs, send, types: () => msgs.map((m) => m.type) };
  }
  return { sessions, client };
}

const result = asMsg({
  type: 'result',
  subtype: 'success',
  is_error: false,
  total_cost_usd: 0,
  duration_ms: 1,
});
const text = (t: string) =>
  asMsg({
    type: 'assistant',
    message: { content: [{ type: 'text', text: t }] },
  });

describe('session manager', () => {
  it('runs a chat turn, keeps history for new subscribers and resets', async () => {
    const { sessions, client } = await setup();
    const c = await client();
    c.send({ type: 'subscribe', spaceId: 's1' });
    await vi.waitFor(() => expect(c.types()).toContain('chat.history'));
    c.send({ type: 'chat.send', spaceId: 's1', text: 'hi' });
    await vi.waitFor(() => expect(sessions[0]?.texts).toEqual(['hi']));
    expect(sessions[0].o.appendSystemPrompt).toBe(
      "# plugin-master context\nThe files below are the source of truth for this plugin's goal and current state. Read them before acting.",
    );
    sessions[0].o.onMessage(text('hello'));
    sessions[0].o.onMessage(result);
    await vi.waitFor(() =>
      expect(c.msgs.filter((m) => m.type === 'chat.status')).toEqual([
        {
          type: 'chat.status',
          spaceId: 's1',
          status: 'running',
          contextFiles: [],
          missingContext: [],
        },
        {
          type: 'chat.status',
          spaceId: 's1',
          status: 'idle',
          contextFiles: [],
          missingContext: [],
        },
      ]),
    );

    const c2 = await client();
    c2.send({ type: 'subscribe', spaceId: 's1' });
    await vi.waitFor(() =>
      expect(c2.msgs[0]).toMatchObject({
        type: 'chat.history',
        status: 'idle',
        contextFiles: [],
        missingContext: [],
        events: [{ kind: 'user' }, { kind: 'text' }, { kind: 'result' }],
      }),
    );

    c2.send({ type: 'chat.reset', spaceId: 's1' });
    await vi.waitFor(() => expect(sessions[0].closed).toBe(true));
    await vi.waitFor(() =>
      expect(c2.msgs.at(-1)).toMatchObject({
        type: 'chat.history',
        events: [],
      }),
    );
  });

  it('puts pinned files into the prompt and reports contextFiles', async () => {
    const { sessions, client } = await setup(['gone.md', 'IDEA.md']);
    const c = await client();
    c.send({ type: 'subscribe', spaceId: 's1' });
    c.send({ type: 'chat.send', spaceId: 's1', text: 'hi' });
    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0].o.appendSystemPrompt).toContain(
      '<file path="IDEA.md">\nCODENAME-X\n</file>',
    );
    await vi.waitFor(() =>
      expect(c.msgs.at(-1)).toMatchObject({
        type: 'chat.status',
        contextFiles: ['gone.md', 'IDEA.md'],
        missingContext: ['gone.md'],
      }),
    );
  });

  it('surfaces an invalid pinned path as an error and starts no session', async () => {
    const { sessions, client } = await setup(['../x']);
    const c = await client();
    c.send({ type: 'chat.send', spaceId: 's1', text: 'hi' });
    await vi.waitFor(() => expect(c.types()).toContain('error'));
    expect(sessions).toHaveLength(0);
  });

  it('stays running until every queued turn has a result', async () => {
    const { sessions, client } = await setup();
    const c = await client();
    c.send({ type: 'subscribe', spaceId: 's1' });
    c.send({ type: 'chat.send', spaceId: 's1', text: 'one' });
    c.send({ type: 'chat.send', spaceId: 's1', text: 'two' });
    await vi.waitFor(() => expect(sessions[0]?.texts).toEqual(['one', 'two']));
    sessions[0].o.onMessage(result);
    sessions[0].o.onMessage(text('x'));
    expect(c.msgs.filter((m) => m.type === 'chat.status')).toHaveLength(1);
    sessions[0].o.onMessage(result);
    await vi.waitFor(() =>
      expect(c.msgs.at(-1)).toMatchObject({
        type: 'chat.status',
        status: 'idle',
      }),
    );
  });

  it('forwards interrupt, resolves permissions and recovers from SDK errors', async () => {
    const { sessions, client } = await setup();
    const c = await client();
    c.send({ type: 'subscribe', spaceId: 's1' });
    c.send({ type: 'chat.send', spaceId: 's1', text: 'go' });
    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    c.send({ type: 'chat.interrupt', spaceId: 's1' });
    await vi.waitFor(() => expect(sessions[0].interrupted).toBe(1));

    const decision = sessions[0].o.canUseTool('Write', { a: 1 }, {
      signal: new AbortController().signal,
      toolUseID: 'x',
    } as Parameters<SessionOptions['canUseTool']>[2]);
    await vi.waitFor(() => expect(c.types()).toContain('permission.request'));
    const req = c.msgs.find((m) => m.type === 'permission.request');
    c.send({
      type: 'permission.reply',
      requestId: (req as { requestId: string }).requestId,
      allow: false,
    });
    expect(await decision).toEqual({
      behavior: 'deny',
      message: 'Denied by user',
    });

    sessions[0].o.onError(new Error('boom'));
    await vi.waitFor(() =>
      expect(c.msgs.at(-1)).toEqual({
        type: 'chat.status',
        spaceId: 's1',
        status: 'idle',
        contextFiles: null,
        missingContext: [],
      }),
    );
    expect(
      c.msgs.some((m) => m.type === 'chat.event' && m.event.kind === 'error'),
    ).toBe(true);
    c.send({ type: 'chat.send', spaceId: 's1', text: 'again' });
    await vi.waitFor(() => expect(sessions).toHaveLength(2)); // fresh session after the error
  });

  it('tags errors about a space message with its spaceId', async () => {
    const { client } = await setup();
    const c = await client();
    c.send({ type: 'chat.send', spaceId: 'missing', text: 'x' });
    await vi.waitFor(() =>
      expect(c.msgs[0]).toMatchObject({ type: 'error', spaceId: 'missing' }),
    );
  });

  it('concurrent sends share one session', async () => {
    const { sessions, client } = await setup();
    const c = await client();
    c.send({ type: 'chat.send', spaceId: 's1', text: 'a' });
    c.send({ type: 'chat.send', spaceId: 's1', text: 'b' });
    await vi.waitFor(() => expect(sessions[0]?.texts).toEqual(['a', 'b']));
    expect(sessions).toHaveLength(1);
  });
});
