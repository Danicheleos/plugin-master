import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ChatEvent } from '@pm/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { CHUNK_CALLS, MAX_ITEMS, MessageList } from './MessageList';

const request = vi.hoisted(() => vi.fn(() => new Promise(() => undefined)));
vi.mock('../../api/http', async (orig) => ({
  ...(await orig<object>()),
  request,
}));

const renderList = (events: ChatEvent[]) =>
  render(
    <MantineProvider>
      <MessageList events={events} conversation={1} />
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
  expect(screen.getByText('5 earlier events hidden')).toBeTruthy();
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
          conversation={1}
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
  expect(screen.getByText('1 earlier event hidden')).toBeTruthy();
  expect(screen.queryByText('first')).toBeNull();
  expect(screen.getByText(/ 2 tool calls: Read ×2$/)).toBeTruthy();
});

type Scrollable = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};
const proto = () =>
  (globalThis as unknown as { HTMLElement: { prototype: object } }).HTMLElement
    .prototype;
const stub = (name: 'scrollHeight' | 'clientHeight', v: number) =>
  Object.defineProperty(proto(), name, { configurable: true, get: () => v });
const unstub = () => {
  delete (proto() as Record<string, unknown>).scrollHeight;
  delete (proto() as Record<string, unknown>).clientHeight;
};

const commit = (n: number): ChatEvent => ({
  kind: 'commit',
  hash: `abcdef${n}`,
  files: n,
  message: 'm',
});
const view = (events: ChatEvent[], conversation = 1) => (
  <MantineProvider>
    <MessageList events={events} conversation={conversation} />
  </MantineProvider>
);
const listOf = (container: unknown) =>
  (container as { querySelector(s: string): unknown }).querySelector(
    'div[class*="list"]',
  ) as Scrollable;
const scrolled = (el: Scrollable, top: number) => {
  el.scrollTop = top;
  fireEvent.scroll(el as unknown as Element);
};

it('does not move when events are appended while the reader scrolled up', () => {
  stub('scrollHeight', 1000);
  stub('clientHeight', 300);
  const { container, rerender } = render(view([commit(1)]));
  const el = listOf(container);
  expect(el.scrollTop).toBe(1000); // mount jumps to the end
  scrolled(el, 40); // reading old messages
  stub('scrollHeight', 1200);
  rerender(view([commit(1), commit(2)]));
  expect(el.scrollTop).toBe(40);
  unstub();
});

it('follows appended events while at the bottom (within 24px)', () => {
  stub('scrollHeight', 1000);
  stub('clientHeight', 300);
  const { container, rerender } = render(view([commit(1)]));
  const el = listOf(container);
  scrolled(el, 700); // exactly the bottom
  stub('scrollHeight', 1100);
  rerender(view([commit(1), commit(2)]));
  expect(el.scrollTop).toBe(1100);
  scrolled(el, 1100 - 300 - 24); // 24px above: still following
  stub('scrollHeight', 1200);
  rerender(view([commit(1), commit(2), commit(3)]));
  expect(el.scrollTop).toBe(1200);
  scrolled(el, 1200 - 300 - 25); // 25px above: not following
  stub('scrollHeight', 1300);
  rerender(view([commit(1), commit(2), commit(3), commit(4)]));
  expect(el.scrollTop).toBe(1200 - 300 - 25);
  unstub();
});

it('jumps to the end when the conversation changes, even after scrolling up', () => {
  stub('scrollHeight', 500);
  stub('clientHeight', 100);
  const a: ChatEvent = { kind: 'text', text: 'one' };
  const { container, rerender } = render(view([a]));
  const el = listOf(container);
  expect(el.scrollTop).toBe(500);
  scrolled(el, 40);
  stub('scrollHeight', 900);
  rerender(view([a, { kind: 'text', text: 'two' }]));
  expect(el.scrollTop).toBe(40);
  rerender(view([{ kind: 'text', text: 'other' }], 2));
  expect(el.scrollTop).toBe(900);
  unstub();
});

it('nests a subagent tool calls under its Agent call, collapsed until opened; old events without a parent stay flat', () => {
  renderList([
    {
      kind: 'tool_use',
      id: 'a1',
      name: 'Agent',
      input: { description: 'Look around' },
    },
    {
      kind: 'tool_use',
      id: 's1',
      name: 'Grep',
      input: { pattern: 'needle' },
      parentToolUseId: 'a1',
    },
    {
      kind: 'tool_result',
      toolUseId: 's1',
      isError: false,
      preview: 'found it',
      parentToolUseId: 'a1',
    },
    { kind: 'tool_result', toolUseId: 'a1', isError: false, preview: 'done' },
    { kind: 'text', text: 'between' },
    { kind: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/x.md' } },
  ]);
  const groups = screen.getAllByRole('button', { name: /tool call/ });
  expect(groups).toHaveLength(2);
  expect(groups[0]).toHaveProperty('textContent', '▸ 1 tool call: Agent');
  expect(groups[1]).toHaveProperty('textContent', '▸ 1 tool call: Read');
  fireEvent.click(groups[0]);
  const sub = screen.getByRole('button', {
    name: /Subagent: 1 tool call: Grep/,
    expanded: false,
  });
  expect(screen.queryByText(/needle/)).toBeNull();
  fireEvent.click(sub);
  expect(screen.getAllByText(/needle/).length).toBeGreaterThan(0);
  const details = screen.getAllByRole('button', { name: 'details' });
  fireEvent.click(details[details.length - 1]);
  expect(screen.getByText('found it')).toBeTruthy();
});

it('stops at a parent cycle in subagent events', () => {
  renderList([
    { kind: 'tool_use', id: 'a1', name: 'Agent', input: {} },
    {
      kind: 'tool_use',
      id: 'a2',
      name: 'Agent',
      input: {},
      parentToolUseId: 'a1',
    },
    {
      kind: 'tool_use',
      id: 'a1',
      name: 'Agent',
      input: {},
      parentToolUseId: 'a2',
    },
  ]);
  fireEvent.click(screen.getByRole('button', { name: /1 tool call: Agent/ }));
  fireEvent.click(
    screen.getByRole('button', { name: /Subagent: 1 tool call: Agent/ }),
  );
  fireEvent.click(
    screen.getAllByRole('button', {
      name: /Subagent: 1 tool call: Agent/,
      expanded: false,
    })[0],
  );
  // the call that closes the cycle gets no subagent block of its own
  expect(
    screen.getAllByRole('button', { name: /^[▸▾] Subagent/ }),
  ).toHaveLength(2);
});

it('splits a long subagent block into chunks of CHUNK_CALLS calls, only the last expanded and the others unmounted', () => {
  const n = CHUNK_CALLS * 2 + 20;
  renderList([
    { kind: 'tool_use', id: 'a1', name: 'Agent', input: {} },
    ...Array.from({ length: n }, (_, i): ChatEvent => ({
      kind: 'tool_use',
      id: `s${i}`,
      name: i % 2 ? 'Bash' : 'Read',
      input: { file_path: `/f${i}.md`, command: `cmd ${i}` },
      parentToolUseId: 'a1',
    })),
  ]);
  fireEvent.click(screen.getByRole('button', { name: /1 tool call: Agent/ }));
  fireEvent.click(screen.getByRole('button', { name: /^▸ Subagent/ }));
  const chunks = screen.getAllByRole('button', { name: /^[▸▾] calls / });
  expect(chunks).toHaveLength(3);
  expect(chunks[0]).toHaveProperty(
    'textContent',
    '▸ calls 1–50 · Read×25, Bash×25',
  );
  expect(chunks[1]).toHaveProperty(
    'textContent',
    '▸ calls 51–100 · Read×25, Bash×25',
  );
  expect(chunks[2]).toHaveProperty(
    'textContent',
    '▾ calls 101–120 · Read×10, Bash×10',
  );
  expect(screen.queryByText('/f0.md')).toBeNull();
  expect(screen.getByText('/f100.md')).toBeTruthy();
  fireEvent.click(chunks[0]);
  expect(screen.getByText('/f0.md')).toBeTruthy();
  expect(screen.queryByText('/f50.md')).toBeNull();
});

it('collapses the previous last chunk when a live subagent grows past a chunk boundary, keeping chunks the user toggled', () => {
  const events = (n: number): ChatEvent[] => [
    { kind: 'tool_use', id: 'a1', name: 'Agent', input: {} },
    ...Array.from({ length: n }, (_, i): ChatEvent => ({
      kind: 'tool_use',
      id: `s${i}`,
      name: 'Read',
      input: { file_path: `/f${i}.md` },
      parentToolUseId: 'a1',
    })),
  ];
  const view = (n: number) => (
    <MantineProvider>
      <MessageList events={events(n)} conversation={1} />
    </MantineProvider>
  );
  const { rerender } = render(view(CHUNK_CALLS * 2));
  fireEvent.click(screen.getByRole('button', { name: /1 tool call: Agent/ }));
  fireEvent.click(screen.getByRole('button', { name: /^▸ Subagent/ }));
  const chunk = (k: number) =>
    screen.getAllByRole('button', { name: /^[▸▾] calls / })[k];
  expect(chunk(0)).toHaveProperty('ariaExpanded', 'false');
  expect(chunk(1)).toHaveProperty('ariaExpanded', 'true');
  fireEvent.click(chunk(0)); // the user opens the first chunk
  rerender(view(CHUNK_CALLS * 2 + 5));
  expect(chunk(0)).toHaveProperty('ariaExpanded', 'true'); // user choice kept
  expect(chunk(1)).toHaveProperty('ariaExpanded', 'false'); // no longer last
  expect(chunk(2)).toHaveProperty('ariaExpanded', 'true'); // the new last chunk
  expect(screen.queryByText('/f50.md')).toBeNull();
  expect(screen.getByText('/f100.md')).toBeTruthy();
});
