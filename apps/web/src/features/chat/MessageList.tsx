import {
  Fragment,
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Anchor, Button, Paper, Text, Typography } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  chatWindowStart,
  MAX_CHAT_ROWS,
  type ChatEvent,
  type TraceToolUse,
} from '@pm/protocol';
import { toolKind } from '../../shared/trace/describeTool';
import { ToolCall } from '../../shared/trace/TraceFlow';
import { useFollowedOpen } from '../../shared/trace/useFollowedOpen';
import { LiveRunTraceModal } from './LiveTraceModals';
import {
  callNames,
  pairTools,
  splitSubagents,
  subSize,
  subOf,
  summary,
  toRows,
  type Sub,
  type ToolEvent,
} from './toolRows';
import styles from './chat.module.scss';
import { cost, shortHash } from '../../shared/format';

/** Tables scroll sideways inside their wrapper instead of widening the chat. */
const MD_COMPONENTS = {
  table: ({
    node: _node,
    ...props
  }: ComponentProps<'table'> & { node?: unknown }) => (
    <div className={styles.tableWrap}>
      <table {...props} />
    </div>
  ),
};

// memo: events are append-only and immutable, so old messages are never re-parsed as Markdown
const Item = memo(function Item({ e }: { e: Exclude<ChatEvent, ToolEvent> }) {
  switch (e.kind) {
    case 'user':
      return (
        <Paper bg="var(--mantine-color-default-hover)" px="sm">
          <Typography>
            <Markdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
              {e.text}
            </Markdown>
          </Typography>
        </Paper>
      );
    case 'text':
      return (
        <Typography>
          <Markdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
            {e.text}
          </Markdown>
        </Typography>
      );
    case 'result':
      return (
        <Text size="xs" c="dimmed" my="xs">
          {e.isError ? 'Finished with an error' : 'Done'}
          {e.durationMs !== undefined &&
            ` · ${(e.durationMs / 1000).toFixed(1)} s`}
          {e.costUsd !== undefined && ` · ${cost(e.costUsd, 4)}`}
        </Text>
      );
    case 'commit':
      return (
        <Text size="xs" c="dimmed" my="xs">
          Committed {shortHash(e.hash)} · {e.files} file
          {e.files === 1 ? '' : 's'} · {e.message}
        </Text>
      );
    case 'error':
      return <Text c="red">{e.message}</Text>;
  }
});

/** Within this many px of the bottom the list keeps following new events. */
const STICK_PX = 24;

/** Rendered rows at most (a tool group at the cut is kept whole); older ones are hidden behind a note. */
export const MAX_ITEMS = MAX_CHAT_ROWS;

type Session = { spaceId?: string; sessionId?: string | null };
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

// events are append-only: a group only changes when it grows (its own events or its subagents')
const ToolGroup = memo(
  function ToolGroup({
    tools,
    sub,
    spaceId,
    sessionId,
  }: {
    tools: ToolEvent[];
    /** the subagent events under this group's calls only (`subOf`) */
    sub: Sub;
    /** their number: re-renders the group when they grow */
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
          <LiveRunTraceModal
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

/** Chat events, following the end while the reader is at the bottom; `spaceId`/`sessionId` give Agent calls an "Open run trace" link to this session's recorded run. */
export const MessageList = memo(function MessageList({
  events,
  earlier = 0,
  conversation,
  spaceId,
  sessionId,
}: {
  events: ChatEvent[];
  /** events already dropped before `events` (counted in the note) */
  earlier?: number;
  /** changes when a conversation (re)appears: jumps to the end */
  conversation: number;
} & Session) {
  // the last MAX_ITEMS rows; a tool group is never split, and rows keep their key and open
  // state while the window slides (absolute indices)
  const { rows, sub, hidden } = useMemo(() => {
    const start = chatWindowStart(events, MAX_ITEMS);
    const split = splitSubagents(events.slice(start), earlier + start);
    return {
      rows: toRows(split.master, split.at),
      sub: split.sub,
      hidden: earlier + start,
    };
  }, [events, earlier]);
  const [trace, setTrace] = useState(false);
  // follow the end only while the reader is at (or within STICK_PX of) the bottom; a conversation
  // that (re)appears (mount, resume, new session, reconnect) always jumps to the end
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const shownConversation = useRef<number>(undefined);
  useLayoutEffect(() => {
    const el = listRef.current;
    const fresh = shownConversation.current !== conversation;
    shownConversation.current = conversation;
    if (events.length === 0 || !el) return;
    if (fresh || atBottom.current) {
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
    }
  }, [events, conversation]);
  return (
    <div
      className={styles.list}
      ref={listRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current =
          el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
      }}
    >
      {hidden > 0 && (
        <Text size="xs" c="dimmed" ta="center">
          {hidden} earlier event{hidden === 1 ? '' : 's'} hidden
          {spaceId && sessionId && (
            <>
              {' · '}
              <Anchor
                component="button"
                size="xs"
                onClick={() => setTrace(true)}
              >
                Open full trace
              </Anchor>
            </>
          )}
        </Text>
      )}
      {trace && spaceId && sessionId && (
        <LiveRunTraceModal
          spaceId={spaceId}
          runId={sessionId}
          title={sessionId}
          onClose={() => setTrace(false)}
        />
      )}
      {rows.map((r) => {
        if (!('tools' in r)) return <Item key={r.at} e={r.e} />;
        const own = subOf(r.tools, sub);
        return (
          <ToolGroup
            key={r.at}
            tools={r.tools}
            sub={own}
            subCount={subSize(own)}
            spaceId={spaceId}
            sessionId={sessionId}
          />
        );
      })}
    </div>
  );
});
