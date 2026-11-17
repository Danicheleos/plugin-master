import { describe, expect, it } from 'vitest';
import {
  MAX_CHAT_ROWS,
  type ChatEvent,
  type ServerMessage,
} from '@pm/protocol';
import { chatReducer, initialChatState, type ChatState } from './reducer';

const session: Omit<
  Extract<ServerMessage, { type: 'chat.status' }>,
  'type' | 'spaceId'
> = {
  status: 'idle',
  mode: 'plan',
  model: 'claude-sonnet-5-5',
  effort: 'high',
  contextFiles: ['a.md'],
  missingContext: ['b.md'],
  sessionId: 'sess',
};
const history = (extra: object = {}): ServerMessage => ({
  type: 'chat.history',
  spaceId: 's',
  events: [{ kind: 'text', text: 'old' }],
  ...session,
  ...extra,
});
const text = (t: string): ChatEvent => ({ kind: 'text', text: t });
const permission = (requestId: string): ServerMessage => ({
  type: 'permission.request',
  spaceId: 's',
  requestId,
  toolName: 'Bash',
  input: {},
});
const run = (msgs: ServerMessage[], from: ChatState = initialChatState) =>
  msgs.reduce(chatReducer, from);

describe('chatReducer', () => {
  it('chat.history replaces the log, sets the session and bumps the conversation', () => {
    const s = run([history({ earlier: 4 }), history()]);
    expect(s.log).toEqual({
      events: [text('old')],
      earlier: 0,
      conversation: 2,
    });
    expect(s).toMatchObject(session);
    expect(run([history({ earlier: 4 })]).log.earlier).toBe(4);
  });

  it('chat.history drops pending permission requests, chat.status only when idle', () => {
    const asked = run([permission('1')]);
    expect(asked.permissions).toHaveLength(1);
    expect(run([history()], asked).permissions).toEqual([]);
    const running = {
      type: 'chat.status',
      spaceId: 's',
      ...session,
      status: 'running',
    } as const;
    expect(chatReducer(asked, running).permissions).toHaveLength(1);
    expect(
      chatReducer(asked, { ...running, status: 'idle' }).permissions,
    ).toEqual([]);
  });

  it('chat.status updates status and settings but keeps the log', () => {
    const s = run([
      history(),
      {
        type: 'chat.status',
        spaceId: 's',
        ...session,
        status: 'running',
        mode: 'auto',
      },
    ]);
    expect(s.status).toBe('running');
    expect(s.mode).toBe('auto');
    expect(s.log.events).toEqual([text('old')]);
  });

  it('keeps list identities when a status message repeats the same lists', () => {
    const a = run([history()]);
    const b = chatReducer(a, { type: 'chat.status', spaceId: 's', ...session });
    expect(b.contextFiles).toBe(a.contextFiles);
    expect(b.missingContext).toBe(a.missingContext);
  });

  it('chat.event appends and windows the log like the server', () => {
    const n = MAX_CHAT_ROWS + 10;
    const s = run(
      Array.from({ length: n }, (_, i) => ({
        type: 'chat.event' as const,
        spaceId: 's',
        event: text(String(i)),
      })),
    );
    expect(s.log.events.length + s.log.earlier).toBe(n);
    expect(s.log.earlier).toBeGreaterThan(0);
    expect(s.log.events.at(-1)).toEqual(text(String(n - 1)));
  });

  it('error messages are appended as error events', () => {
    const s = run([{ type: 'error', message: 'boom' }]);
    expect(s.log.events).toEqual([{ kind: 'error', message: 'boom' }]);
  });

  it('agent.stats replaces the stats only', () => {
    const s = run([
      {
        type: 'agent.stats',
        spaceId: 's',
        master: null,
        current: 'Read',
        tasks: [],
      },
    ]);
    expect(s.stats).toEqual({ master: null, current: 'Read', tasks: [] });
    expect(s.log).toBe(initialChatState.log);
  });

  it('queues permission requests and removes an answered one', () => {
    const s = run([permission('1'), permission('2')]);
    expect(s.permissions.map((p) => p.requestId)).toEqual(['1', '2']);
    const left = chatReducer(s, {
      type: 'permission.answered',
      requestId: '1',
    });
    expect(left.permissions.map((p) => p.requestId)).toEqual(['2']);
  });

  it('returns the same state for messages it does not handle', () => {
    expect(
      chatReducer(initialChatState, { type: 'git.changed', spaceId: 's' }),
    ).toBe(initialChatState);
  });
});
