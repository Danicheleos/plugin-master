import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ChatEvent } from '@pm/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { MAX_ITEMS, MessageList } from './MessageList';

const request = vi.hoisted(() => vi.fn(() => new Promise(() => undefined)));
vi.mock('../../api/http', async (orig) => ({
  ...(await orig<object>()),
  request,
}));

const renderList = (events: ChatEvent[]) =>
  render(
    <MantineProvider>
      <MessageList events={events} />
    </MantineProvider>,
  );

it('renders a commit event as a dimmed line', () => {
  renderList([
    { kind: 'commit', hash: 'abcdef1234', files: 2, message: 'agent: do it' },
  ]);
  expect(
    screen.getByText(/Committed abcdef1 · 2 files · agent: do it/),
  ).toBeTruthy();
});

it('renders only the last MAX_ITEMS events with a note', () => {
  const events: ChatEvent[] = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => ({
    kind: 'error',
    message: `msg-${i}`,
  }));
  renderList(events);
  expect(screen.getByText('5 earlier messages hidden')).toBeTruthy();
  expect(screen.queryByText('msg-4')).toBeNull();
  expect(screen.getByText('msg-5')).toBeTruthy();
  expect(screen.getByText(`msg-${MAX_ITEMS + 4}`)).toBeTruthy();
  expect(screen.getAllByText(/^msg-\d+$/)).toHaveLength(MAX_ITEMS);
});

it('groups consecutive tool calls into a collapsed block', () => {
  renderList([
    { kind: 'text', text: 'Looking' },
    { kind: 'tool_use', id: '1', name: 'Read', input: { file: 'a' } },
    { kind: 'tool_result', toolUseId: '1', isError: false, preview: 'aaa' },
    { kind: 'tool_use', id: '2', name: 'Read', input: { file: 'b' } },
    { kind: 'tool_result', toolUseId: '2', isError: false, preview: 'bbb' },
    { kind: 'tool_use', id: '3', name: 'Edit', input: {} },
    { kind: 'tool_result', toolUseId: '3', isError: true, preview: 'ccc' },
    { kind: 'text', text: 'Finished' },
  ]);
  expect(screen.getByText('Looking')).toBeTruthy();
  expect(screen.getByText('Finished')).toBeTruthy();
  const header = screen.getByText(/3 tool calls: Read ×2, Edit · 1 error/);
  expect(screen.queryByText('Read')).toBeNull();
  fireEvent.click(header);
  expect(screen.getAllByText('Read')).toHaveLength(2);
  expect(screen.getByText('Edit')).toBeTruthy();
  fireEvent.click(screen.getByText(/3 tool calls/));
  expect(screen.queryByText('Read')).toBeNull();
});

it('renders a call with its result as the shared trace tool row, Agent calls linking to the run trace', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider>
        <MessageList
          spaceId="s"
          sessionId="sess-1"
          events={[
            {
              kind: 'tool_use',
              id: '1',
              name: 'Read',
              input: { file_path: '/x/SKILL.md' },
            },
            {
              kind: 'tool_use',
              id: '2',
              name: 'Agent',
              input: { description: 'Review it', prompt: 'p' },
            },
            {
              kind: 'tool_result',
              toolUseId: '1',
              isError: true,
              preview: 'no such file',
            },
            {
              kind: 'tool_result',
              toolUseId: '2',
              isError: false,
              preview: 'looks fine',
            },
          ]}
        />
      </MantineProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText(/2 tool calls/));
  expect(screen.getByText('/x/SKILL.md')).toBeTruthy(); // describeTool summary
  expect(screen.getByText('Review it')).toBeTruthy();
  expect(screen.getByText('error')).toBeTruthy(); // the result's error is on the call row
  fireEvent.click(screen.getAllByText('details')[0] as HTMLElement);
  expect(screen.getByText('no such file')).toBeTruthy();
  expect(screen.getAllByText('Open run trace')).toHaveLength(1);
  fireEvent.click(screen.getByText('Open run trace'));
  expect(screen.getByText('Run: sess-1')).toBeTruthy();
  expect(request.mock.calls.at(-1)?.slice(0, 2)).toEqual([
    'GET',
    '/api/spaces/s/runs/sess-1/trace',
  ]);
});

it('does not split a tool group at the MAX_ITEMS cut', () => {
  const tools: ChatEvent[] = Array.from({ length: 4 }, (_, i) =>
    i % 2
      ? {
          kind: 'tool_result',
          toolUseId: `t${i}`,
          isError: false,
          preview: 'r',
        }
      : { kind: 'tool_use', id: `t${i}`, name: 'Read', input: {} },
  );
  const rest: ChatEvent[] = Array.from({ length: MAX_ITEMS - 1 }, (_, i) => ({
    kind: 'error',
    message: `msg-${i}`,
  }));
  renderList([{ kind: 'text', text: 'first' }, ...tools, ...rest]);
  expect(screen.getByText('1 earlier message hidden')).toBeTruthy();
  expect(screen.queryByText('first')).toBeNull();
  expect(screen.getByText(/ 2 tool calls: Read ×2$/)).toBeTruthy();
});

it('never scrolls by itself when events are appended', () => {
  const commit = (n: number): ChatEvent => ({
    kind: 'commit',
    hash: `abcdef${n}`,
    files: n,
    message: 'm',
  });
  const view = (events: ChatEvent[]) => (
    <MantineProvider>
      <MessageList events={events} />
    </MantineProvider>
  );
  const { container, rerender } = render(view([commit(1)]));
  const list = (
    container as unknown as { firstElementChild: { scrollTop: number } }
  ).firstElementChild;
  list.scrollTop = 40;
  rerender(view([commit(1), commit(2)]));
  expect(list.scrollTop).toBe(40);
});

type Scrollable = { scrollTop: number; scrollHeight: number };
const proto = () =>
  (globalThis as unknown as { HTMLElement: { prototype: object } }).HTMLElement
    .prototype;
const stubHeight = (h: number) =>
  Object.defineProperty(proto(), 'scrollHeight', {
    configurable: true,
    get: () => h,
  });

it('scrolls to the bottom on init and conversation change, not on append', () => {
  stubHeight(500);
  const ui = (events: ChatEvent[]) => (
    <MantineProvider>
      <MessageList events={events} />
    </MantineProvider>
  );
  const a: ChatEvent = { kind: 'text', text: 'one' };
  const { container, rerender } = render(ui([a]));
  const el = (
    container as unknown as { querySelector(s: string): unknown }
  ).querySelector('div[class*="list"]') as Scrollable;
  expect(el.scrollTop).toBe(500);

  el.scrollTop = 40;
  stubHeight(900);
  rerender(ui([a, { kind: 'text', text: 'two' }]));
  expect(el.scrollTop).toBe(40);

  rerender(ui([{ kind: 'text', text: 'other' }]));
  expect(el.scrollTop).toBe(900);
  delete (proto() as Record<string, unknown>).scrollHeight;
});
