import { act, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@pm/protocol';
import {
  ChatProvider,
  useChatActions,
  useChatLog,
  useChatStats,
  useChatStatus,
  useOnChatIdle,
} from './ChatContext';

let emit: (msg: ServerMessage) => void = () => undefined;
vi.mock('../../api/ws', () => ({
  send: vi.fn(),
  useSpaceEvents: (_id: string, handler: (msg: ServerMessage) => void) => {
    emit = handler;
  },
}));
vi.mock('../sound/sounds', () => ({ playFinished: vi.fn() }));

const renders = { status: 0, idle: 0, actions: 0, log: 0, stats: 0 };
const seen = { actions: new Set<unknown>() };

function Status() {
  useChatStatus();
  renders.status++;
  return null;
}
function Idle() {
  useOnChatIdle(() => undefined);
  renders.idle++;
  return null;
}
function Actions() {
  seen.actions.add(useChatActions());
  renders.actions++;
  return null;
}
function Log() {
  useChatLog();
  renders.log++;
  return null;
}
function Stats() {
  useChatStats();
  renders.stats++;
  return null;
}

const status = (s: 'idle' | 'running'): ServerMessage => ({
  type: 'chat.status',
  spaceId: 's',
  status: s,
  mode: 'auto',
  model: 'claude-sonnet-5-5',
  effort: 'default',
  contextFiles: null,
  missingContext: [],
  sessionId: null,
});

describe('ChatProvider slices', () => {
  it('re-renders a consumer only when its slice changes', () => {
    render(
      <MantineProvider>
        <ChatProvider spaceId="s">
          <Status />
          <Idle />
          <Actions />
          <Log />
          <Stats />
        </ChatProvider>
      </MantineProvider>,
    );
    const base = { ...renders };

    act(() =>
      emit({
        type: 'chat.event',
        spaceId: 's',
        event: { kind: 'text', text: 'x' },
      }),
    );
    expect(renders.log).toBe(base.log + 1);
    expect(renders.status).toBe(base.status);
    expect(renders.idle).toBe(base.idle);
    expect(renders.actions).toBe(base.actions);
    expect(renders.stats).toBe(base.stats);

    act(() =>
      emit({
        type: 'agent.stats',
        spaceId: 's',
        master: null,
        current: 'Read',
        tasks: [],
      }),
    );
    expect(renders.stats).toBe(base.stats + 1);
    expect(renders.status).toBe(base.status);
    expect(renders.log).toBe(base.log + 1);

    act(() => emit(status('running')));
    expect(renders.status).toBe(base.status + 1);
    expect(renders.idle).toBe(base.idle + 1);
    expect(renders.actions).toBe(base.actions);
    expect(seen.actions.size).toBe(1);
  });
});
