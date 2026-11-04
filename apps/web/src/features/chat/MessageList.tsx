import {
  Fragment,
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Markdown from 'react-markdown';
import { Anchor, Button, Paper, Text, Typography } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { ChatEvent, TraceToolUse } from '@pm/protocol';
import { toolKind } from '../evals/describeTool';
import { ToolCall } from '../evals/TraceFlow';
import { useFollowedOpen } from '../evals/useFollowedOpen';
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
/** Subagent tool events by their parent Agent/Task tool use id. */
type Sub = Map<string, ToolEvent[]>;

/** Master events, and the subagent tool events (`parentToolUseId`) by parent call. */
function splitSubagents(events: ChatEvent[]): {
  master: ChatEvent[];
  sub: Sub;
} {
  const sub: Sub = new Map();
  const master: ChatEvent[] = [];
  for (const e of events) {
    if (!isTool(e) || !e.parentToolUseId) {
      master.push(e);
      continue;
    }
    let list = sub.get(e.parentToolUseId);
    if (!list) sub.set(e.parentToolUseId, (list = []));
    list.push(e);
  }
  return { master, sub };
}

/** Subagent events under these calls, nested subagents included; `seen` stops a parent cycle. */
function countSub(
  tools: ToolEvent[],
  sub: Sub,
  seen = new Set<string>(),
): number {
  let n = 0;
  for (const e of tools) {
    if (e.kind !== 'tool_use' || seen.has(e.id)) continue;
    const kids = sub.get(e.id);
    if (!kids) continue;
    seen.add(e.id);
    n += kids.length + countSub(kids, sub, seen);
  }
  return n;
}

/** Tool call rows (paired); an Agent/Task call gets `agentAction` and its subagent's calls below it. */
function Calls({
  calls,
  sub,
  agentAction,
  seen = new Set(),
}: {
  calls: TraceToolUse[];
  sub: Sub;
  agentAction?: ReactNode;
  /** Agent calls already rendered above (a parent cycle renders nothing more) */
  seen?: ReadonlySet<string>;
}) {
  return calls.map((t) => {
    const agent = toolKind(t.name) === 'agent';
    const kids = agent && !seen.has(t.id) ? sub.get(t.id) : undefined;
    return (
      <Fragment key={t.id}>
        <ToolCall t={t} action={agent ? agentAction : undefined} />
        {kids && (
          <SubagentCalls
            tools={kids}
            sub={sub}
            seen={new Set(seen).add(t.id)}
          />
        )}
      </Fragment>
    );
  });
}

/** Paired calls per chunk inside a subagent block. */
export const CHUNK_CALLS = 50;

const callNames = (calls: TraceToolUse[]) => {
  const counts = new Map<string, number>();
  for (const c of calls) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  return [...counts].map(([n, k]) => (k > 1 ? `${n}×${k}` : n)).join(', ');
};

/** One chunk of a subagent's calls; its rows mount only while expanded. */
function Chunk({
  from,
  calls,
  sub,
  seen,
  last,
}: {
  from: number;
  calls: TraceToolUse[];
  sub: Sub;
  seen: ReadonlySet<string>;
  /** the last chunk is open until the user toggles it; an untouched chunk closes when a new one follows */
  last: boolean;
}) {
  const [open, toggle] = useFollowedOpen(last);
  return (
    <div>
      <Button
        variant="subtle"
        color="gray"
        size="compact-xs"
        aria-expanded={open}
        onClick={toggle}
      >
        {open ? '▾' : '▸'} calls {from + 1}–{from + calls.length} ·{' '}
        {callNames(calls)}
      </Button>
      {open && <Calls calls={calls} sub={sub} seen={seen} />}
    </div>
  );
}

/**
 * A subagent's own tool calls with their results, collapsed (and unmounted) until opened; more
 * than `CHUNK_CALLS` calls are split into chunks, only the last one expanded.
 */
function SubagentCalls({
  tools,
  sub,
  seen,
}: {
  tools: ToolEvent[];
  sub: Sub;
  seen: ReadonlySet<string>;
}) {
  const [open, { toggle }] = useDisclosure(false);
  const calls = useMemo(() => (open ? pairTools(tools) : []), [open, tools]);
  const chunks: number[] = [];
  for (let k = 0; k < calls.length; k += CHUNK_CALLS) chunks.push(k);
  return (
    <div className={styles.subagent}>
      <Button
        variant="subtle"
        color="gray"
        size="compact-xs"
        aria-expanded={open}
        onClick={toggle}
      >
        {open ? '▾' : '▸'} Subagent: {summary(tools)}
      </Button>
      {open &&
        (chunks.length > 1 ? (
          chunks.map((from, k) => (
            <Chunk
              key={from}
              from={from}
              calls={calls.slice(from, from + CHUNK_CALLS)}
              sub={sub}
              seen={seen}
              last={k === chunks.length - 1}
            />
          ))
        ) : (
          <Calls calls={calls} sub={sub} seen={seen} />
        ))}
    </div>
  );
}

// events are append-only: a group only changes when it grows
const ToolGroup = memo(
  function ToolGroup({
    tools,
    sub,
    spaceId,
    sessionId,
  }: {
    tools: ToolEvent[];
    sub: Sub;
    /** subagent events under this group; re-renders the group when they grow */
    subCount: number;
  } & Session) {
    const [open, { toggle }] = useDisclosure(false);
    const [trace, setTrace] = useState(false);
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
            <Calls calls={pairTools(tools)} sub={sub} agentAction={link} />
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
    a.subCount === b.subCount &&
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
  const { master, sub } = useMemo(() => splitSubagents(events), [events]);
  let hidden = Math.max(0, master.length - MAX_ITEMS);
  while (hidden > 0 && isTool(master[hidden]) && isTool(master[hidden - 1]))
    hidden--;
  const rows = useMemo(
    () => toRows(hidden ? master.slice(hidden) : master, hidden),
    [master, hidden],
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
            sub={sub}
            subCount={countSub(r.tools, sub)}
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
