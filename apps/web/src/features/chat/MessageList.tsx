import { memo, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import { Button, Code, Collapse, Paper, Text, Typography } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { ChatEvent } from '@pm/protocol';
import styles from './chat.module.scss';

function Tool({
  label,
  color,
  children,
}: {
  label: string;
  color: string;
  children: ReactNode;
}) {
  const [open, { toggle }] = useDisclosure(false);
  return (
    <div>
      <Button variant="subtle" color={color} size="compact-xs" onClick={toggle}>
        {label}
      </Button>
      <Collapse expanded={open}>
        <Code block fz="xs">
          {children}
        </Code>
      </Collapse>
    </div>
  );
}

// memo: events are append-only and immutable, so old messages are never re-parsed as Markdown
const Item = memo(function Item({ e }: { e: ChatEvent }) {
  switch (e.kind) {
    case 'user':
      return (
        <Paper bg="var(--mantine-color-default-hover)" px="sm">
          <Typography>
            <Markdown>{e.text}</Markdown>
          </Typography>
        </Paper>
      );
    case 'text':
      return (
        <Typography>
          <Markdown>{e.text}</Markdown>
        </Typography>
      );
    case 'tool_use':
      return (
        <Tool label={`🔧 ${e.name}`} color="gray">
          {JSON.stringify(e.input, null, 2)}
        </Tool>
      );
    case 'tool_result':
      return (
        <Tool
          label={e.isError ? 'Tool error' : 'Result'}
          color={e.isError ? 'red' : 'gray'}
        >
          {e.preview}
        </Tool>
      );
    case 'result':
      return (
        <Text size="xs" c="dimmed" my="xs">
          {e.isError ? 'Finished with an error' : 'Done'}
          {e.durationMs !== undefined &&
            ` · ${(e.durationMs / 1000).toFixed(1)} s`}
          {e.costUsd !== undefined && ` · $${e.costUsd.toFixed(4)}`}
        </Text>
      );
    case 'commit':
      return (
        <Text size="xs" c="dimmed" my="xs">
          Committed {e.hash.slice(0, 7)} · {e.files} file
          {e.files === 1 ? '' : 's'} · {e.message}
        </Text>
      );
    case 'error':
      return <Text c="red">{e.message}</Text>;
  }
});

/** Rendered events at most (a tool group at the cut is kept whole); older ones are hidden behind a note. */
export const MAX_ITEMS = 300;

type ToolEvent = Extract<ChatEvent, { kind: 'tool_use' | 'tool_result' }>;
type Row = { at: number; e: ChatEvent } | { at: number; tools: ToolEvent[] };

const isTool = (e: ChatEvent): e is ToolEvent =>
  e.kind === 'tool_use' || e.kind === 'tool_result';

/** Groups consecutive tool calls and results; `at` = absolute index of the first event (stable key). */
function toRows(events: ChatEvent[], offset: number): Row[] {
  const rows: Row[] = [];
  events.forEach((e, i) => {
    const last = rows[rows.length - 1];
    if (!isTool(e)) rows.push({ at: offset + i, e });
    else if (last && 'tools' in last) last.tools.push(e);
    else rows.push({ at: offset + i, tools: [e] });
  });
  return rows;
}

function summary(tools: ToolEvent[]): string {
  const counts = new Map<string, number>();
  for (const t of tools)
    if (t.kind === 'tool_use')
      counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const names = [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n));
  const errors = tools.filter(
    (t) => t.kind === 'tool_result' && t.isError,
  ).length;
  return (
    `${total} tool call${total === 1 ? '' : 's'}` +
    (names.length ? `: ${names.join(', ')}` : '') +
    (errors ? ` · ${errors} error${errors === 1 ? '' : 's'}` : '')
  );
}

// events are append-only: a group only changes when it grows
const ToolGroup = memo(
  function ToolGroup({ tools }: { tools: ToolEvent[] }) {
    const [open, { toggle }] = useDisclosure(false);
    return (
      <div>
        <Button
          variant="subtle"
          color="gray"
          size="compact-xs"
          aria-expanded={open}
          onClick={toggle}
        >
          {open ? '▾' : '▸'} {summary(tools)}
        </Button>
        {open && (
          <div className={styles.tools}>
            {tools.map((e, i) => (
              <Item key={i} e={e} />
            ))}
          </div>
        )}
      </div>
    );
  },
  (a, b) => a.tools.length === b.tools.length && a.tools[0] === b.tools[0],
);

export const MessageList = memo(function MessageList({
  events,
}: {
  events: ChatEvent[];
}) {
  // never split a tool group (a result from its call): start at the group's first event, which
  // also keeps the group's key and open state while the window slides
  let hidden = Math.max(0, events.length - MAX_ITEMS);
  while (hidden > 0 && isTool(events[hidden]) && isTool(events[hidden - 1]))
    hidden--;
  const rows = useMemo(
    () => toRows(hidden ? events.slice(hidden) : events, hidden),
    [events, hidden],
  );
  // scroll to the end only when a conversation appears (mount, resume, new session): its first
  // event is a new object; appended events keep it, so they never move the scroll
  const listRef = useRef<HTMLDivElement>(null);
  const first = events[0];
  useLayoutEffect(() => {
    const el = listRef.current;
    if (first && el) el.scrollTop = el.scrollHeight;
  }, [first]);
  return (
    <div className={styles.list} ref={listRef}>
      {hidden > 0 && (
        <Text size="xs" c="dimmed" ta="center">
          {hidden} earlier message{hidden === 1 ? '' : 's'} hidden
        </Text>
      )}
      {rows.map((r) =>
        'tools' in r ? (
          <ToolGroup key={r.at} tools={r.tools} />
        ) : (
          <Item key={r.at} e={r.e} />
        ),
      )}
    </div>
  );
});
