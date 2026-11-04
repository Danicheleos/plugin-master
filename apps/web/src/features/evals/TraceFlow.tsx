import { createContext, useContext, type ReactNode } from 'react';
import {
  Anchor,
  Badge,
  Code,
  Collapse,
  Group,
  Paper,
  Text,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type {
  Trace,
  TraceSubagent,
  TraceToolUse,
  TraceTurn,
} from '@pm/protocol';
import { describeTool, toolKind, type ToolKind } from './describeTool';
import { cost, seconds, tokens } from './format';
import styles from './evals.module.scss';
import { useFollowedOpen } from './useFollowedOpen';
import { DetailView } from './DetailView';

const COLOR: Record<ToolKind, string> = {
  skill: 'grape',
  read: 'blue',
  edit: 'orange',
  bash: 'teal',
  agent: 'violet',
  other: 'gray',
};
const LABEL: Record<ToolKind, string> = {
  skill: 'skill fired',
  read: 'read',
  edit: 'edit',
  bash: 'bash',
  agent: 'subagent',
  other: 'tool',
};
const COLLAPSE_OVER = 4;

/** Per trace: the recorded subagent metadata by Agent/Task tool use id. */
const FlowContext = createContext<Map<string, TraceSubagent>>(new Map());

/** Text clamped to a few lines with a toggle that shows all of it (shown only when it can be longer than the clamp). */
function Excerpt({
  text,
  lines,
  ...rest
}: {
  text: string;
  lines: number;
  size?: string;
  c?: string;
  fs?: string;
}) {
  const [open, { toggle }] = useDisclosure(false);
  const long = text.length > lines * 60 || text.split('\n').length > lines;
  return (
    <>
      <Text
        {...rest}
        lineClamp={open ? undefined : lines}
        className={styles.excerpt}
      >
        {text}
      </Text>
      {long && (
        <Anchor
          component="button"
          size="xs"
          onClick={toggle}
          aria-expanded={open}
        >
          {open ? 'show less' : 'show full'}
        </Anchor>
      )}
    </>
  );
}

function Block({
  children,
  color,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <Paper
      withBorder
      p="xs"
      radius="sm"
      className={styles.block}
      style={
        color ? { borderColor: `var(--mantine-color-${color}-6)` } : undefined
      }
    >
      {children}
    </Paper>
  );
}

/** What the trace recorded about a subagent call: type, description, status, tokens, tool uses, duration. */
function SubagentLine({ s }: { s: TraceSubagent }) {
  const parts = [
    s.subagentType,
    s.description,
    s.status,
    s.totalTokens !== undefined && `${tokens(s.totalTokens)} tokens`,
    s.toolUses !== undefined && `${s.toolUses} tool uses`,
    s.durationMs !== undefined && seconds(s.durationMs),
  ].filter(Boolean);
  return parts.length ? (
    <Text size="xs" c="dimmed" aria-label="subagent">
      {parts.join(' · ')}
    </Text>
  ) : null;
}

/** One tool call: kind badge, `describeTool` summary, input/result details, a subagent's lane; `action` goes after the details toggle. */
export function ToolCall({
  t,
  action,
}: {
  t: TraceToolUse;
  action?: ReactNode;
}) {
  const [open, { toggle }] = useDisclosure(false);
  const subagents = useContext(FlowContext);
  const kind = toolKind(t.name);
  const err = t.result?.isError;
  const sub = kind === 'agent' ? subagents.get(t.id) : undefined;
  return (
    <div className={styles.branch}>
      <Block color={err ? 'red' : kind === 'skill' ? COLOR.skill : undefined}>
        <Group gap="xs" wrap="nowrap">
          <Badge
            color={COLOR[kind]}
            variant={kind === 'skill' ? 'filled' : 'light'}
          >
            {kind === 'skill'
              ? `skill fired: ${describeTool(t.name, t.input)}`
              : t.name}
          </Badge>
          {kind !== 'skill' && (
            <Text size="xs" truncate>
              {describeTool(t.name, t.input)}
            </Text>
          )}
          {err && <Badge color="red">error</Badge>}
          <Anchor
            component="button"
            size="xs"
            onClick={toggle}
            aria-expanded={open}
          >
            {open ? 'hide' : 'details'}
          </Anchor>
          {action}
        </Group>
        {sub && <SubagentLine s={sub} />}
        {/* mounted (and parsed) only while open */}
        {open && (
          <>
            <DetailView text={t.input} />
            {t.result && (
              <DetailView
                text={t.result.preview}
                color={err ? 'red' : undefined}
              />
            )}
          </>
        )}
      </Block>
      {t.turns && (
        <div className={styles.lane}>
          <Flow turns={t.turns} />
        </div>
      )}
    </div>
  );
}

function Run({ kind, tools }: { kind: ToolKind; tools: TraceToolUse[] }) {
  const [open, { toggle }] = useDisclosure(false);
  const errors = tools.filter((t) => t.result?.isError).length;
  return (
    <div className={styles.branch}>
      <Block color={errors ? 'red' : undefined}>
        <Group gap="xs">
          <Badge color={COLOR[kind]}>
            {tools.length} {LABEL[kind]}s
          </Badge>
          {errors > 0 && <Badge color="red">{errors} errors</Badge>}
          <Anchor
            component="button"
            size="xs"
            onClick={toggle}
            aria-expanded={open}
          >
            {open ? 'hide' : 'show'}
          </Anchor>
        </Group>
      </Block>
      {open && tools.map((t) => <ToolCall key={t.id} t={t} />)}
    </div>
  );
}

/** Consecutive same-kind tool calls; long runs (except subagents) become one block. */
function Tools({ tools }: { tools: TraceToolUse[] }) {
  const runs: { kind: ToolKind; tools: TraceToolUse[] }[] = [];
  for (const t of tools) {
    const kind = toolKind(t.name);
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.tools.push(t);
    else runs.push({ kind, tools: [t] });
  }
  return runs.map((r) =>
    r.kind !== 'agent' &&
    r.kind !== 'skill' &&
    r.tools.length > COLLAPSE_OVER ? (
      <Run key={r.tools[0]?.id} kind={r.kind} tools={r.tools} />
    ) : (
      r.tools.map((t) => <ToolCall key={t.id} t={t} />)
    ),
  );
}

function Flow({ turns, start = 0 }: { turns: TraceTurn[]; start?: number }) {
  return (
    <div className={styles.flow}>
      {turns.map((t, i) => (
        <div key={t.id} className={styles.step}>
          <Block>
            <Group gap="xs">
              <Text size="sm" fw={600}>
                Turn {start + i + 1}
              </Text>
              <Text size="xs" c="dimmed">
                context {tokens(t.context)} · out {tokens(t.outputTokens)}
              </Text>
            </Group>
            {t.thinking && (
              <Excerpt
                text={t.thinking}
                lines={4}
                size="xs"
                c="dimmed"
                fs="italic"
              />
            )}
            {t.text && <Excerpt text={t.text} lines={6} size="sm" />}
          </Block>
          <Tools tools={t.tools} />
        </div>
      ))}
    </div>
  );
}

/** A collapsed block whose body (fully shown, scrollable) opens on click. */
function Fold({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const [open, { toggle }] = useDisclosure(false);
  return (
    <div className={styles.step}>
      <Block>
        <Group gap="xs">
          <Anchor
            component="button"
            size="sm"
            fw={600}
            aria-expanded={open}
            onClick={toggle}
          >
            {open ? '▾' : '▸'} {title}
          </Anchor>
          {hint && (
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          )}
        </Group>
        <Collapse expanded={open}>{children}</Collapse>
      </Block>
    </div>
  );
}

/** What the trace records before the first model call: the system prompt (when stored) and the context entries. */
function Preamble({ preamble }: { preamble: NonNullable<Trace['preamble']> }) {
  const { system, items } = preamble;
  return (
    <>
      {system && (
        <Fold
          title="System prompt"
          hint={`${system.length.toLocaleString()} chars`}
        >
          <Code block className={styles.preText}>
            {system}
          </Code>
        </Fold>
      )}
      {items.length > 0 && (
        <Fold
          title="Context before the first turn"
          hint={`${items.length} entries`}
        >
          {items.map((it, i) => (
            <PreambleItem key={i} kind={it.kind} text={it.text} />
          ))}
        </Fold>
      )}
    </>
  );
}

function PreambleItem({ kind, text }: { kind: string; text: string }) {
  const [open, { toggle }] = useDisclosure(false);
  return (
    <div>
      <Group gap="xs" mt={4}>
        <Anchor
          component="button"
          size="xs"
          aria-expanded={open}
          onClick={toggle}
        >
          {open ? '▾' : '▸'} {kind}
        </Anchor>
        <Text size="xs" c="dimmed">
          {text.length.toLocaleString()} chars
        </Text>
      </Group>
      <Collapse expanded={open}>
        <Code block className={styles.preText}>
          {text}
        </Code>
      </Collapse>
    </div>
  );
}

/** The top-level turns split at each user prompt; turns before the first prompt form their own group. */
export function promptGroups(trace: Trace) {
  const ps = trace.prompts ?? [];
  const starts = ps.map((p) => p.turn);
  const groups: { text?: string; start: number; turns: TraceTurn[] }[] = [];
  if (!ps.length || ps[0].turn > 0)
    groups.push({ start: 0, turns: trace.turns.slice(0, starts[0]) });
  ps.forEach((p, k) =>
    groups.push({
      text: p.text,
      start: p.turn,
      turns: trace.turns.slice(p.turn, starts[k + 1]),
    }),
  );
  return groups;
}

const countTools = (turns: TraceTurn[]): number =>
  turns.reduce(
    (n, t) =>
      n +
      t.tools.length +
      t.tools.reduce((m, x) => m + (x.turns ? countTools(x.turns) : 0), 0),
    0,
  );

/** One prompt and its turns; the turns mount only while expanded. */
function PromptGroup({
  text,
  start,
  turns,
  byDefault,
}: {
  text?: string;
  start: number;
  turns: TraceTurn[];
  /** the default (last group with turns); followed until the user toggles the group */
  byDefault: boolean;
}) {
  const [open, toggle] = useFollowedOpen(byDefault);
  return (
    <div className={styles.step}>
      <Block>
        <Group gap="xs" wrap="nowrap">
          <Anchor
            component="button"
            size="sm"
            fw={600}
            aria-expanded={open}
            onClick={toggle}
          >
            {open ? '▾' : '▸'}
          </Anchor>
          <Text size="sm" truncate flex={1} title={text}>
            {text ?? '(before the first prompt)'}
          </Text>
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            {turns.length} turns · {countTools(turns)} tool calls
          </Text>
        </Group>
        {open && text && <Excerpt text={text} lines={8} size="sm" />}
      </Block>
      {open && <Flow turns={turns} start={start} />}
    </div>
  );
}

/**
 * Vertical block scheme of a run: preamble, prompt, each model turn with its tool calls, result.
 * `byPrompt` (session/run traces): the turns are grouped under each user prompt (`Trace.prompts`),
 * every group collapsed and unmounted except the last one that has turns; the preamble then drops
 * its top-level user entries (the first prompt is the first group's header).
 */
export function TraceFlow({
  trace,
  byPrompt = false,
}: {
  trace: Trace;
  byPrompt?: boolean;
}) {
  const m = trace.metrics;
  const subagents = new Map(m.subagents.map((s) => [s.toolUseId, s]));
  const groups = byPrompt && trace.prompts?.length ? promptGroups(trace) : null;
  const openGroup = groups
    ? groups.reduce((at, g, k) => (g.turns.length ? k : at), -1)
    : -1;
  const preamble =
    groups && trace.preamble
      ? {
          ...trace.preamble,
          items: trace.preamble.items.filter((i) => i.kind !== 'user'),
        }
      : trace.preamble;
  return (
    <FlowContext.Provider value={subagents}>
      <div className={styles.flow}>
        {preamble && <Preamble preamble={preamble} />}
        {!groups && trace.prompt && (
          <div className={styles.step}>
            <Block>
              <Text size="xs" c="dimmed">
                Prompt
              </Text>
              <Excerpt text={trace.prompt} lines={8} size="sm" />
            </Block>
          </div>
        )}
        {groups ? (
          groups.map((g, k) => (
            <PromptGroup
              key={g.start}
              text={g.text}
              start={g.start}
              turns={g.turns}
              byDefault={k === openGroup}
            />
          ))
        ) : (
          <Flow turns={trace.turns} />
        )}
        <div className={styles.step}>
          <Block color={m.isError ? 'red' : undefined}>
            <Text size="sm" fw={600}>
              Result
            </Text>
            <Text size="xs" c="dimmed">
              {m.numTurns ?? trace.turns.length} turns · {cost(m.costUsd)} ·{' '}
              {seconds(m.durationMs)}
              {m.toolErrors > 0 && ` · ${m.toolErrors} tool errors`}
              {m.permissionDenials > 0 &&
                ` · ${m.permissionDenials} permission denials`}
            </Text>
          </Block>
        </div>
      </div>
    </FlowContext.Provider>
  );
}
