import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '@pm/protocol';
import { ChatPanel } from './ChatPanel';

const renders = { list: 0, select: 0 };

vi.mock('@mantine/core', async (importActual) => {
  const actual = await importActual<typeof import('@mantine/core')>();
  return {
    ...actual,
    Select: (p: React.ComponentProps<typeof actual.Select>) => {
      renders.select++;
      return <actual.Select {...p} />;
    },
  };
});
vi.mock('./MessageList', () => ({
  MessageList: () => {
    renders.list++;
    return null;
  },
}));
vi.mock('../context/ContextSummary', () => ({ ContextSummary: () => null }));
vi.mock('./hooks', () => ({
  useSessions: () => ({ data: [] }),
  useDeleteSession: () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    error: null,
    isPending: false,
  }),
}));
vi.mock('../../shared/trace/RunTraceModal', () => ({
  SubagentTraceModal: (p: { toolUseId: string; title: string }) => (
    <div>
      trace of {p.toolUseId}: {p.title}
    </div>
  ),
}));

const events: ChatEvent[] = [{ kind: 'text', text: 'hi' }];
const chat: Record<string, unknown> & {
  stats: { tasks: unknown[]; master: null; current: null };
} = {
  events,
  status: 'idle',
  mode: 'auto',
  model: 'sonnet',
  effort: 'default',
  stats: { master: null, current: null, tasks: [] },
  sessionId: null as string | null,
  contextFiles: null,
  missingContext: [],
  send: vi.fn(),
  interrupt: vi.fn(),
  setModel: vi.fn(),
  setEffort: vi.fn(),
  setMode: vi.fn(),
  reset: vi.fn(),
  resume: vi.fn(),
};
vi.mock('./ChatContext', () => ({
  useChatStatus: () => chat.status,
  useChatSettings: () => chat,
  useChatLog: () => ({ events, earlier: 0, conversation: 1 }),
  useChatStats: () => chat.stats,
  useChatActions: () => chat,
  useChatLiveRun: () => ({ tick: 0, running: false }),
}));

describe('ChatPanel typing', () => {
  beforeEach(() => {
    renders.list = 0;
    renders.select = 0;
  });

  it('does not re-render the message list or selects per keystroke', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MantineProvider>
          <ChatPanel spaceId="s" />
        </MantineProvider>
      </QueryClientProvider>,
    );
    const list = renders.list;
    const select = renders.select;
    const box = screen.getByPlaceholderText(/Message/);
    for (const v of ['h', 'he', 'hel', 'hell', 'hello'])
      fireEvent.change(box, { target: { value: v } });
    expect(screen.getByDisplayValue('hello')).toBeTruthy();
    expect(renders.list).toBe(list);
    expect(renders.select).toBe(select);
  });
});

describe('ChatPanel running agents', () => {
  const ui = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MantineProvider>
          <ChatPanel spaceId="s" />
        </MantineProvider>
      </QueryClientProvider>,
    );

  it('shows who each running agent is, its task and action, and opens only its trace', () => {
    chat.sessionId = 'sess-1';
    chat.stats = {
      master: null,
      current: null,
      tasks: [
        {
          id: 'k1',
          name: 'scout',
          subagentType: 'Explore',
          description: 'Find the auth flow',
          status: 'running',
          tokens: 1200,
          toolUses: 3,
          toolUseId: 'toolu_1',
          action: 'Grep: login',
        },
        {
          id: 'k2',
          description: 'done',
          status: 'completed',
          tokens: 0,
          toolUses: 0,
        },
      ],
    };
    ui();
    const line = screen.getByRole('button', {
      name: 'Open the trace of scout',
    });
    expect(line).toHaveProperty(
      'textContent',
      expect.stringContaining(
        'scout (Explore) · Find the auth flow · Grep: login',
      ),
    );
    expect(screen.queryByText(/done/)).toBeNull();
    fireEvent.click(line);
    expect(
      screen.getByText('trace of toolu_1: Agent: scout · Find the auth flow'),
    ).toBeTruthy();
  });
});
