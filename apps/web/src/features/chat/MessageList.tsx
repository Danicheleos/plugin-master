import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Anchor, Button, Paper, Text, Typography } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { ChatEvent, TraceToolUse } from '@pm/protocol';
import { toolKind } from '../evals/describeTool';
import { ToolCall } from '../evals/TraceFlow';
import { RunTraceModal } from '../runs/RunsList';
import styles from './chat.module.scss';

// memo: events are append-only and immutable, so old messages are never re-parsed as Markdown
const Item = memo(function Item({ e }: { e: Exclude<ChatEvent, ToolEvent> }) {
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
type Row =
  | { at: number; e: Exclude<ChatEvent, ToolEvent> }
  | { at: number; tools: ToolEvent[] };

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

/** Tool calls of a group with their results (by `toolUseId`), as trace tool uses; a result without its call stands alone. */
function pairTools(tools: ToolEvent[]): TraceToolUse[] {
  const out: TraceToolUse[] = [];
  const byId = new Map<string, TraceToolUse>();
  for (const e of tools) {
    if (e.kind === 'tool_use') {
      const t: TraceToolUse = {
        id: e.id,
        name: e.name,
        input: JSON.stringify(e.input ?? null),
      };
      byId.set(e.id, t);
      out.push(t);
    } else {
      const result = { preview: e.preview, isError: e.isError };
      const t = byId.get(e.toolUseId);
      if (t) t.result = result;
      else out.push({ id: e.toolUseId, name: 'Result', input: '', result });
    }
  }
  return out;
}

type Session = { spaceId?: string; sessionId?: string | null };

// events are append-only: a group only changes when it grows
const ToolGroup = memo(
  function ToolGroup({
    tools,
    spaceId,
    sessionId,
  }: { tools: ToolEvent[] } & Session) {
    const [open, { toggle }] = useDisclosure(false);
    const [trace, setTrace] = useState(false);
    const calls = useMemo(() => pairTools(tools), [tools]);
    const link = spaceId && sessionId && (
      <Anchor component="button" size="xs" onClick={() => setTrace(true)}>
        Open run trace
      </Anchor>
    );
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
            {calls.map((t) => (
              <ToolCall
                key={t.id}
                t={t}
                action={toolKind(t.name) === 'agent' ? link : undefined}
              />
            ))}
          </div>
        )}
        {trace && spaceId && sessionId && (
          <RunTraceModal
            spaceId={spaceId}
            runId={sessionId}
            title={sessionId}
            onClose={() => setTrace(false)}
          />
        )}
      </div>
    );
  },
  (a, b) =>
    a.tools.length === b.tools.length &&
    a.tools[0] === b.tools[0] &&
    a.spaceId === b.spaceId &&
    a.sessionId === b.sessionId,
);

/** Chat events; `spaceId`/`sessionId` give Agent calls an "Open run trace" link to this session's recorded run. */
export const MessageList = memo(function MessageList({
  events,
  spaceId,
  sessionId,
}: {
  events: ChatEvent[];
} & Session) {
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
          <ToolGroup
            key={r.at}
            tools={r.tools}
            spaceId={spaceId}
            sessionId={sessionId}
          />
        ) : (
          <Item key={r.at} e={r.e} />
        ),
      )}
    </div>
  );
});
