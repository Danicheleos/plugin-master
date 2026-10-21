import { execFileSync } from 'node:child_process';
import websocket from '@fastify/websocket';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ServerMessage } from '@pm/protocol';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { Config } from '../config';
import { createRegistry } from '../spaces/registry';
import { createHub } from '../ws/hub';
import type { History } from './history';
import type { SessionOptions } from './session';
import { createSessionManager } from './session-manager';

// no dependence on the developer's git config
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
});
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });
const origin = 'http://localhost:5100';
const asMsg = (m: unknown) => m as SDKMessage;
const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function setup(
  masterContext: string[] = [],
  opts: { features?: object; repo?: boolean; evals?: boolean } = {},
) {
  const asked: { dir: string; id: string }[] = [];
  const history: History = {
    list: async () => [],
    all: async () => [],
    trace: async () => undefined,
    events: async (dir, id) => {
      asked.push({ dir, id });
      return [{ kind: 'user', text: 'old' }];
    },
  };
  const home = await mkdtemp(join(tmpdir(), 'pm-chat-'));
  await mkdir(join(home, '.plugin-master'));
  await writeFile(join(home, 'IDEA.md'), 'CODENAME-X');
  await writeFile(
    join(home, '.plugin-master/config.json'),
    JSON.stringify({ masterContext, features: opts.features }),
  );
  if (opts.repo) {
    git(home, 'init', '-q');
    await writeFile(join(home, 'mine.txt'), 'x');
    git(home, 'add', 'IDEA.md', 'mine.txt', '.plugin-master/config.json');
    git(home, 'commit', '-qm', 'init');
  }
  const config: Config = { port: 0, webOrigins: [origin], token: 't', home };
  const registry = createRegistry(home);
  await registry.add({ id: 's1', name: 'p', path: home, createdAt: '' });
  const hub = createHub(config);
  const sessions: {
    o: SessionOptions;
    texts: string[];
    closed: boolean;
    interrupted: number;
    modes: string[];
    models: string[];
    failMode?: boolean;
  }[] = [];
  createSessionManager(
    hub,
    registry,
    (o) => {
      const s = {
        o,
        texts: [] as string[],
        closed: false,
        interrupted: 0,
        modes: [] as string[],
        models: [] as string[],
      };
      sessions.push(s);
      return {
        send: (t) => void s.texts.push(t),
        interrupt: async () => void s.interrupted++,
        setMode: async (m) => {
          (s as { onSetMode?: () => void }).onSetMode?.();
          if ((s as { failMode?: boolean }).failMode) throw new Error('nope');
          s.modes.push(m);
        },
        setModel: async (m) => void s.models.push(m),
        contextUsage: async () => ({
          tokens: 1200,
          max: 2000,
          percent: 60,
          limit: 1800,
        }),
        close: () => void (s.closed = true),
      };
    },
    history,
    undefined,
    opts.evals
      ? { runner: { status: () => ({ state: 'idle' }) } as never }
      : undefined,
  );
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
  return { sessions, client, asked, home };
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
  it('adds the evals MCP server; only eval_status is auto-allowed, eval_run goes to the prompt', async () => {
    const { sessions, client } = await setup([], { evals: true });
    const c = await client();
    c.send({ type: 'subscribe', spaceId: 's1' });
    await vi.waitFor(() => expect(c.types()).toContain('chat.history'));
    c.send({ type: 'chat.send', spaceId: 's1', text: 'hi' });
    await vi.waitFor(() => expect(sessions[0]?.texts).toEqual(['hi']));
    expect(Object.keys(sessions[0].o.mcpServers ?? {})).toEqual([
      'plan',
      'evals',
    ]);
    expect(sessions[0].o.allowedTools).toContain('mcp__evals__eval_status');
    expect(sessions[0].o.allowedTools).not.toContain('mcp__evals__eval_run');
  });

  it('runs a chat turn, keeps history for new subscribers and resets', async () => {
    const { sessions, client } = await setup();
    const c = await client();
    c.send({ type: 'subscribe', spaceId: 's1' });
    await vi.waitFor(() => expect(c.types()).toContain('chat.history'));
    c.send({ type: 'chat.send', spaceId: 's1', text: 'hi' });
    await vi.waitFor(() => expect(sessions[0]?.texts).toEqual(['hi']));
    expect(sessions[0].o.appendSystemPrompt).toMatch(
      /^# Role\nYou are the master agent[^]*# Plans\n[^]*# plugin-master context\nThe files below/,
    );
    expect(sessions[0].o.allowedTools).toContain('mcp__plan__plan_get');
    expect(Object.keys(sessions[0].o.mcpServers ?? {})).toEqual(['plan']);
    sessions[0].o.onMessage(text('hello'));
    sessions[0].o.onMessage(result);
    await vi.waitFor(() =>
      expect(c.msgs.filter((m) => m.type === 'chat.status')).toEqual([
        {
          type: 'chat.status',
          spaceId: 's1',
          status: 'running',
          mode: 'auto',
          model: 'claude-opus-5-5',
          contextFiles: [],
          missingContext: [],
          sessionId: null,
        },
        {
          type: 'chat.status',
          spaceId: 's1',
          status: 'idle',
          mode: 'auto',
          model: 'claude-opus-5-5',
          contextFiles: [],
          missingContext: [],
          sessionId: null,
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
      expect(
        c.msgs.filter((m) => m.type === 'chat.status').at(-1),
      ).toMatchObject({
        type: 'chat.status',
        contextFiles: ['gone.md', 'IDEA.md'],
        missingContext: ['gone.md'],
      }),
    );
  });

  it('passes the userSettings feature to new sessions', async () => {
    for (const [features, want] of [[undefined, false], [{ userSettings: true }, true]] as const) {
      const { sessions, client } = await setup([], { features });
      const c = await client();
      c.send({ type: 'subscribe', spaceId: 's1' });
      c.send({ type: 'chat.send', spaceId: 's1', text: 'hi' });
      await vi.waitFor(() => expect(sessions).toHaveLength(1));
      expect(sessions[0].o.userSettings).toBe(want);
    }
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
    // the `running` status travels over the socket: wait for it before counting
    await vi.waitFor(() =>
      expect(c.msgs.filter((m) => m.type === 'chat.status')).toHaveLength(1),
    );
    sessions[0].o.onMessage(result);
    sessions[0].o.onMessage(text('x'));
    expect(c.msgs.filter((m) => m.type === 'chat.status')).toHaveLength(1);
    sessions[0].o.onMessage(result);
    await vi.waitFor(() =>
      expect(
        c.msgs.filter((m) => m.type === 'chat.status').at(-1),
      ).toMatchObject({
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
        mode: 'auto',
        model: 'claude-opus-5-5',
        contextFiles: null,
        missingContext: [],
        sessionId: null,
      }),
    );
    expect(
      c.msgs.some((m) => m.type === 'chat.event' && m.event.kind === 'error'),
    ).toBe(true);
    c.send({ type: 'chat.send', spaceId: 's1', text: 'again' });
    await vi.waitFor(() => expect(sessions).toHaveLength(2)); // fresh session after the error

    sessions[1].o.onError(
      new Error('Claude Code process exited with code 143'),
    );
    await vi.waitFor(() =>
      expect(
        c.msgs.some(
          (m) =>
            m.type === 'chat.event' &&
            m.event.kind === 'error' &&
            m.event.message.includes('pnpm dev:self'),
        ),
      ).toBe(true),
    );
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

  it('resumes a past session: history, resume id for the next session, reset clears it', async () => {
    const { sessions, client, asked, home } = await setup();
    const c = await client();
    c.send({ type: 'subscribe', spaceId: 's1' });
    c.send({ type: 'chat.resume', spaceId: 's1', sessionId: 'past' });
    await vi.waitFor(() =>
      expect(
        c.msgs.filter((m) => m.type === 'chat.history').at(-1),
      ).toMatchObject({
        type: 'chat.history',
        events: [{ kind: 'user', text: 'old' }],
        sessionId: 'past',
      }),
    );
    expect(asked).toEqual([{ dir: home, id: 'past' }]);

    c.send({ type: 'chat.send', spaceId: 's1', text: 'more' });
    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0].o.resume).toBe('past');
    // a live message reports the (possibly new) session id
    sessions[0].o.onMessage(asMsg({ type: 'system', session_id: 'live' }));
    sessions[0].o.onMessage(result);
    await vi.waitFor(() =>
      expect(
        c.msgs.filter((m) => m.type === 'chat.status').at(-1),
      ).toMatchObject({
        type: 'chat.status',
        status: 'idle',
        sessionId: 'live',
      }),
    );

    c.send({ type: 'chat.reset', spaceId: 's1' });
    await vi.waitFor(() => expect(sessions[0].closed).toBe(true));
    c.send({ type: 'chat.send', spaceId: 's1', text: 'fresh' });
    await vi.waitFor(() => expect(sessions).toHaveLength(2));
    expect(sessions[1].o.resume).toBeUndefined();
  });

  it('broadcasts agent stats: current action, subagent tasks and context usage', async () => {
    const { sessions, client } = await setup();
    const c = await client();
    c.send({ type: 'subscribe', spaceId: 's1' });
    await vi.waitFor(() =>
      expect(c.msgs).toContainEqual(
        expect.objectContaining({
          type: 'agent.stats',
          master: null,
          tasks: [],
        }),
      ),
    );
    c.send({ type: 'chat.send', spaceId: 's1', text: 'hi' });
    await vi.waitFor(() => expect(sessions[0]).toBeDefined());
    const o = sessions[0].o;
    const stats = () =>
      c.msgs.filter(
        (m): m is Extract<ServerMessage, { type: 'agent.stats' }> =>
          m.type === 'agent.stats',
      );
    o.onMessage(
      asMsg({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'Edit',
              input: { file_path: 'a.md' },
            },
          ],
        },
      }),
    );
    o.onMessage(
      asMsg({
        type: 'system',
        subtype: 'task_started',
        task_id: 'k1',
        description: 'Research',
        subagent_type: 'Explore',
      }),
    );
    o.onMessage(
      asMsg({
        type: 'system',
        subtype: 'task_progress',
        task_id: 'k1',
        description: 'Research',
        usage: { total_tokens: 500, tool_uses: 2, duration_ms: 1 },
        last_tool_name: 'Grep',
      }),
    );
    await vi.waitFor(() =>
      expect(stats().at(-1)).toMatchObject({
        current: 'Edit: a.md',
        tasks: [
          {
            id: 'k1',
            status: 'running',
            tokens: 500,
            toolUses: 2,
            lastTool: 'Grep',
          },
        ],
      }),
    );
    o.onMessage(result);
    await vi.waitFor(() =>
      expect(stats().at(-1)).toMatchObject({
        current: null,
        master: { tokens: 1200, max: 2000, percent: 60, limit: 1800 },
      }),
    );

    c.send({ type: 'chat.reset', spaceId: 's1' });
    await vi.waitFor(() =>
      expect(stats().at(-1)).toMatchObject({ master: null, tasks: [] }),
    );
  });

  it('tracks the permission mode per space', async () => {
    const { sessions, client } = await setup();
    const c = await client();
    const modes = () =>
      c.msgs.flatMap((m) =>
        m.type === 'chat.status' || m.type === 'chat.history' ? [m.mode] : [],
      );
    c.send({ type: 'subscribe', spaceId: 's1' });
    await vi.waitFor(() => expect(modes()).toEqual(['auto']));

    // no session yet: the mode is stored and the new session starts with it
    c.send({ type: 'chat.mode', spaceId: 's1', mode: 'plan' });
    await vi.waitFor(() => expect(modes().at(-1)).toBe('plan'));
    c.send({ type: 'chat.send', spaceId: 's1', text: 'hi' });
    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0].o.mode).toBe('plan');

    // live session: forwarded to the SDK
    c.send({ type: 'chat.mode', spaceId: 's1', mode: 'auto' });
    await vi.waitFor(() => expect(sessions[0].modes).toEqual(['auto']));
    expect(modes().at(-1)).toBe('auto');

    // the CLI reports its own switch (ExitPlanMode approved)
    sessions[0].o.onMessage(
      asMsg({
        type: 'system',
        subtype: 'status',
        status: null,
        permissionMode: 'acceptEdits',
      }),
    );
    await vi.waitFor(() => expect(modes().at(-1)).toBe('acceptEdits'));

    // survives New session
    c.send({ type: 'chat.reset', spaceId: 's1' });
    await vi.waitFor(() => expect(sessions[0].closed).toBe(true));
    c.send({ type: 'chat.send', spaceId: 's1', text: 'again' });
    await vi.waitFor(() => expect(sessions).toHaveLength(2));
    expect(sessions[1].o.mode).toBe('acceptEdits');

    // a failed switch is rolled back and reported
    (sessions[1] as { failMode?: boolean }).failMode = true;
    c.send({ type: 'chat.mode', spaceId: 's1', mode: 'dontAsk' });
    await vi.waitFor(() => expect(c.types()).toContain('error'));
    expect(modes().at(-1)).toBe('acceptEdits');

    // a failure after the CLI switched mode itself must not roll back over it
    (sessions[1] as { failMode?: boolean }).failMode = true;
    (sessions[1] as { onSetMode?: () => void }).onSetMode = () =>
      sessions[1].o.onMessage(
        asMsg({
          type: 'system',
          subtype: 'status',
          status: null,
          permissionMode: 'plan',
        }),
      );
    c.send({ type: 'chat.mode', spaceId: 's1', mode: 'dontAsk' });
    await vi.waitFor(() =>
      expect(c.msgs.filter((m) => m.type === 'error')).toHaveLength(2),
    );
    expect(modes().at(-1)).toBe('plan');

    // bypassPermissions is not accepted
    c.send({ type: 'chat.mode', spaceId: 's1', mode: 'bypassPermissions' });
    await vi.waitFor(() =>
      expect(c.msgs.filter((m) => m.type === 'error')).toHaveLength(3),
    );
    expect(sessions[1].modes).toEqual([]);
  });
  it('tracks the model per space', async () => {
    const { sessions, client } = await setup();
    const c = await client();
    const models = () =>
      c.msgs.flatMap((m) =>
        m.type === 'chat.status' || m.type === 'chat.history' ? [m.model] : [],
      );
    c.send({ type: 'subscribe', spaceId: 's1' });
    await vi.waitFor(() => expect(models()).toEqual(['claude-opus-5-5']));

    c.send({ type: 'chat.model', spaceId: 's1', model: 'claude-haiku-5-5' });
    await vi.waitFor(() => expect(models().at(-1)).toBe('claude-haiku-5-5'));
    c.send({ type: 'chat.send', spaceId: 's1', text: 'hi' });
    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0].o.model).toBe('claude-haiku-5-5');

    c.send({ type: 'chat.model', spaceId: 's1', model: 'claude-sonnet-5-5' });
    await vi.waitFor(() =>
      expect(sessions[0].models).toEqual(['claude-sonnet-5-5']),
    );
    expect(models().at(-1)).toBe('claude-sonnet-5-5');

    c.send({ type: 'chat.model', spaceId: 's1', model: 'gpt-4' as never });
    await vi.waitFor(() =>
      expect(c.msgs.filter((m) => m.type === 'error')).toHaveLength(1),
    );
    expect(sessions[0].models).toEqual(['claude-sonnet-5-5']);
  });

  describe('auto-commit', () => {
    // these turns spawn real git processes: allow more than the 1 s default under parallel load
    const wait = <T>(fn: () => T) => vi.waitFor(fn, { timeout: 5000 });
    const on = { git: true, autoCommit: true };
    const sessionRun = { type: 'system', subtype: 'init', session_id: 'sid-1' };
    async function turn(
      opts: Parameters<typeof setup>[1],
      prompt: string,
      edit: (home: string) => Promise<void>,
      pre?: (home: string) => Promise<void>,
    ) {
      const { sessions, client, home } = await setup([], opts);
      const c = await client();
      c.send({ type: 'subscribe', spaceId: 's1' });
      await writeFile(join(home, 'dirty.txt'), 'before'); // dirty before the turn
      await pre?.(home);
      c.send({ type: 'chat.send', spaceId: 's1', text: prompt });
      await wait(() => expect(sessions[0]?.texts).toEqual([prompt]));
      sessions[0].o.onMessage(asMsg(sessionRun));
      await edit(home);
      sessions[0].o.onMessage(result);
      return { c, home, sessions };
    }
    const subjects = (home: string) =>
      git(home, 'log', '--format=%s').trim().split('\n');

    it('commits only paths changed during the turn, with the run id, and reports it', async () => {
      const { c, home } = await turn(
        { features: on, repo: true },
        '\n  Add a skill please\nmore',
        async (h) => {
          await writeFile(join(h, 'new.txt'), 'n');
          await mkdir(join(h, '.plugin-master/runs'), { recursive: true });
          await writeFile(join(h, '.plugin-master/runs/m.jsonl'), '{}');
          await writeFile(join(h, 'mine.txt'), 'changed');
        },
      );
      await wait(() =>
        expect(c.msgs).toContainEqual({ type: 'git.changed', spaceId: 's1' }),
      );
      expect(git(home, 'log', '-1', '--format=%B').trim()).toBe(
        'agent: Add a skill please\n\nRun: sid-1',
      );
      expect(
        git(home, 'show', '--name-only', '--format=', 'HEAD')
          .trim()
          .split('\n')
          .sort(),
      ).toEqual(['mine.txt', 'new.txt']);
      expect(git(home, 'status', '--porcelain', '-uall')).toContain(
        '?? dirty.txt',
      );
      expect(git(home, 'status', '--porcelain', '-uall')).toContain(
        '.plugin-master/runs/m.jsonl',
      );
      const ev = c.msgs.filter(
        (m) => m.type === 'chat.event' && m.event.kind === 'commit',
      );
      expect(ev).toMatchObject([
        {
          event: {
            kind: 'commit',
            files: 2,
            message: 'agent: Add a skill please',
          },
        },
      ]);
    });

    it('commits a file dirty before the turn once the agent edits it again, not an untouched one', async () => {
      const { c, home } = await turn(
        { features: on, repo: true },
        'edit mine',
        async (h) => {
          await writeFile(join(h, 'mine.txt'), 'user edit + agent edit');
          await writeFile(join(h, 'dirty.txt'), 'before'); // rewritten, same content
        },
        async (h) => {
          await writeFile(join(h, 'mine.txt'), 'user edit'); // same M status after the turn
          await writeFile(join(h, 'IDEA.md'), 'user only');
        },
      );
      await wait(() =>
        expect(c.msgs).toContainEqual({ type: 'git.changed', spaceId: 's1' }),
      );
      expect(git(home, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe(
        'mine.txt',
      );
      expect(git(home, 'show', 'HEAD:mine.txt')).toBe('user edit + agent edit');
      const status = git(home, 'status', '--porcelain', '-uall');
      expect(status).toContain(' M IDEA.md');
      expect(status).toContain('?? dirty.txt');
    });

    it('compares files above the hash limit by size and mtime', async () => {
      const big = Buffer.alloc(9 * 1024 * 1024, 1);
      const { c, home } = await turn(
        { features: on, repo: true },
        'big',
        (h) =>
          writeFile(
            join(h, 'edited.bin'),
            Buffer.concat([big, big.subarray(0, 1)]),
          ),
        async (h) => {
          await writeFile(join(h, 'kept.bin'), big);
          await writeFile(join(h, 'edited.bin'), big);
        },
      );
      await wait(() =>
        expect(c.msgs).toContainEqual({ type: 'git.changed', spaceId: 's1' }),
      );
      expect(git(home, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe(
        'edited.bin',
      );
    });

    it('trims long prompts and also commits after an interrupted turn result', async () => {
      const { c, home } = await turn(
        { features: on, repo: true },
        'x'.repeat(100),
        (h) => writeFile(join(h, 'a.txt'), 'a'),
      );
      await wait(() => expect(subjects(home)).toHaveLength(2));
      expect(subjects(home)[0]).toBe(`agent: ${'x'.repeat(59)}…`);
      await wait(() =>
        expect(
          c.msgs.some(
            (m) => m.type === 'chat.event' && m.event.kind === 'commit',
          ),
        ).toBe(true),
      );
    });

    it.each([
      ['autoCommit off', { features: { git: true }, repo: true }],
      ['git off', { features: { autoCommit: true }, repo: true }],
      ['not a repo', { features: on, repo: false }],
    ])('does nothing when %s', async (_n, opts) => {
      const { c, home } = await turn(opts, 'p', (h) =>
        writeFile(join(h, 'a.txt'), 'a'),
      );
      await wait(() =>
        expect(
          c.msgs.filter((m) => m.type === 'chat.status').at(-1),
        ).toMatchObject({ status: 'idle' }),
      );
      await new Promise((r) => setTimeout(r, 100)); // negative check: let a wrong commit land
      expect(c.msgs.some((m) => m.type === 'git.changed')).toBe(false);
      expect(
        c.msgs.some(
          (m) =>
            m.type === 'chat.event' &&
            ['commit', 'error'].includes(m.event.kind),
        ),
      ).toBe(false);
      if (opts.repo) expect(subjects(home)).toEqual(['init']);
    });

    const hook = async (h: string, body: string) => {
      const file = join(h, '.git/hooks/pre-commit');
      await writeFile(file, `#!/bin/sh\n${body}\n`);
      await chmod(file, 0o755);
    };
    const errorEvent = (m: string) =>
      expect.objectContaining({
        type: 'chat.event',
        event: expect.objectContaining({
          kind: 'error',
          message: expect.stringContaining(m),
        }),
      });

    // a hook that only `exit 1`s prints nothing to stderr; it must still be an error
    it('turns a failing commit (silent pre-commit hook) into an error event', async () => {
      const { c, home } = await turn(
        { features: on, repo: true },
        'p',
        async (h) => {
          await hook(h, 'exit 1');
          await writeFile(join(h, 'a.txt'), 'a');
        },
      );
      await wait(() =>
        expect(c.msgs).toContainEqual(errorEvent('git exited 1')),
      );
      expect(subjects(home)).toEqual(['init']);
      expect(c.msgs.some((m) => m.type === 'git.changed')).toBe(false);
    });

    it('commits a staged rename as one change (no leftover deletion)', async () => {
      const { c, home } = await turn(
        { features: on, repo: true },
        'p',
        async (h) => {
          git(h, 'mv', 'mine.txt', 'moved.txt');
        },
      );
      await wait(() => expect(subjects(home)).toHaveLength(2));
      expect(
        git(home, 'show', '--name-status', '--format=', 'HEAD').trim(),
      ).toBe('R100\tmine.txt\tmoved.txt');
      expect(git(home, 'diff', 'HEAD', '--name-only').trim()).toBe(''); // nothing staged or modified is left
      await wait(() =>
        expect(c.msgs).toContainEqual(
          expect.objectContaining({
            event: expect.objectContaining({ kind: 'commit', files: 2 }),
          }),
        ),
      );
    });

    it('skips auto-commit above 200 changed files and says so', async () => {
      const { c, home } = await turn(
        { features: on, repo: true },
        'p',
        async (h) => {
          await mkdir(join(h, 'many'));
          await Promise.all(
            Array.from({ length: 201 }, (_, i) =>
              writeFile(join(h, `many/f${i}.txt`), 'x'),
            ),
          );
        },
      );
      await wait(() =>
        expect(c.msgs).toContainEqual(
          errorEvent('Auto-commit skipped: 201 changed files, commit manually'),
        ),
      );
      expect(subjects(home)).toEqual(['init']);
    });

    it('broadcasts git.changed for a commit that finishes after a reset, without the chat event', async () => {
      const { c, home, sessions } = await turn(
        { features: on, repo: true },
        'p',
        async (h) => {
          // blocks the commit until `go` exists, so the reset can happen while it runs
          await hook(
            h,
            `touch "${h}/started"\nwhile [ ! -f "${h}/go" ]; do sleep 0.02; done`,
          );
          await writeFile(join(h, 'a.txt'), 'a');
        },
      );
      await wait(() => expect(existsSync(join(home, 'started'))).toBe(true));
      c.send({ type: 'chat.reset', spaceId: 's1' });
      await vi.waitFor(() => expect(sessions[0].closed).toBe(true), {
        timeout: 5000,
      });
      await writeFile(join(home, 'go'), '');
      await wait(() =>
        expect(c.msgs).toContainEqual({ type: 'git.changed', spaceId: 's1' }),
      );
      expect(subjects(home)).toHaveLength(2);
      expect(
        c.msgs.some(
          (m) => m.type === 'chat.event' && m.event.kind === 'commit',
        ),
      ).toBe(false);
    });
  });
});
