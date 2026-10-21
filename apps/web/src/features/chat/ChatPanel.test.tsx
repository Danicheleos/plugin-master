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
vi.mock('./hooks', () => ({ useSessions: () => ({ data: [] }) }));

const events: ChatEvent[] = [{ kind: 'text', text: 'hi' }];
const chat = {
  events,
  status: 'idle',
  mode: 'auto',
  model: 'sonnet',
  sessionId: null,
  contextFiles: null,
  missingContext: [],
  send: vi.fn(),
  interrupt: vi.fn(),
  setModel: vi.fn(),
  setMode: vi.fn(),
  reset: vi.fn(),
  resume: vi.fn(),
};
vi.mock('./ChatContext', () => ({ useChatContext: () => chat }));

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
