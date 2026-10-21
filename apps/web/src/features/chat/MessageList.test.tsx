import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ChatEvent } from '@pm/protocol';
import { expect, it } from 'vitest';
import { MAX_ITEMS, MessageList } from './MessageList';

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
  expect(screen.queryByText('🔧 Read')).toBeNull();
  fireEvent.click(header);
  expect(screen.getAllByText('🔧 Read')).toHaveLength(2);
  expect(screen.getByText('🔧 Edit')).toBeTruthy();
  fireEvent.click(screen.getByText(/3 tool calls/));
  expect(screen.queryByText('🔧 Read')).toBeNull();
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
