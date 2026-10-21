import { Anchor, Badge, Code, Collapse, Group, Paper, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { Trace, TraceToolUse, TraceTurn } from '@pm/protocol';
import { describeTool, toolKind, type ToolKind } from './describeTool';
import { cost, seconds, tokens } from './format';
import styles from './evals.module.scss';

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

/** Text clamped to a few lines with a toggle that shows all of it (shown only when it can be longer than the clamp). */
function Excerpt({ text, lines, ...rest }: { text: string; lines: number; size?: string; c?: string; fs?: string }) {
  const [open, { toggle }] = useDisclosure(false);
  const long = text.length > lines * 60 || text.split('\n').length > lines;
  return (
    <>
      <Text {...rest} lineClamp={open ? undefined : lines} className={styles.excerpt}>
        {text}
      </Text>
      {long && (
        <Anchor component="button" size="xs" onClick={toggle} aria-expanded={open}>
          {open ? 'show less' : 'show full'}
        </Anchor>
      )}
    </>
  );
}

function Block({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <Paper withBorder p="xs" radius="sm" className={styles.block} style={color ? { borderColor: `var(--mantine-color-${color}-6)` } : undefined}>
      {children}
    </Paper>
  );
}

function Tool({ t }: { t: TraceToolUse }) {
  const [open, { toggle }] = useDisclosure(false);
  const kind = toolKind(t.name);
  const err = t.result?.isError;
  return (
    <div className={styles.branch}>
      <Block color={err ? 'red' : kind === 'skill' ? COLOR.skill : undefined}>
        <Group gap="xs" wrap="nowrap">
          <Badge color={COLOR[kind]} variant={kind === 'skill' ? 'filled' : 'light'}>
            {kind === 'skill' ? `skill fired: ${describeTool(t.name, t.input)}` : t.name}
          </Badge>
          {kind !== 'skill' && (
            <Text size="xs" truncate>
              {describeTool(t.name, t.input)}
            </Text>
          )}
          {err && <Badge color="red">error</Badge>}
          <Anchor component="button" size="xs" onClick={toggle} aria-expanded={open}>
            {open ? 'hide' : 'details'}
          </Anchor>
        </Group>
        <Collapse expanded={open}>
          <Code block fz="xs">
            {t.input}
          </Code>
          {t.result && (
            <Code block fz="xs" c={err ? 'red' : undefined}>
              {t.result.preview || '(empty)'}
            </Code>
          )}
        </Collapse>
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
          <Anchor component="button" size="xs" onClick={toggle} aria-expanded={open}>
            {open ? 'hide' : 'show'}
          </Anchor>
        </Group>
      </Block>
      {open && tools.map((t) => <Tool key={t.id} t={t} />)}
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
    r.kind !== 'agent' && r.kind !== 'skill' && r.tools.length > COLLAPSE_OVER ? (
      <Run key={r.tools[0]?.id} kind={r.kind} tools={r.tools} />
    ) : (
      r.tools.map((t) => <Tool key={t.id} t={t} />)
    ),
  );
}

function Flow({ turns }: { turns: TraceTurn[] }) {
  return (
    <div className={styles.flow}>
      {turns.map((t, i) => (
        <div key={t.id} className={styles.step}>
          <Block>
            <Group gap="xs">
              <Text size="sm" fw={600}>
                Turn {i + 1}
              </Text>
              <Text size="xs" c="dimmed">
                context {tokens(t.context)} · out {tokens(t.outputTokens)}
              </Text>
            </Group>
            {t.thinking && (
              <Excerpt text={t.thinking} lines={4} size="xs" c="dimmed" fs="italic" />
            )}
            {t.text && (
              <Excerpt text={t.text} lines={6} size="sm" />
            )}
          </Block>
          <Tools tools={t.tools} />
        </div>
      ))}
    </div>
  );
}

/** A collapsed block whose body (fully shown, scrollable) opens on click. */
function Fold({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const [open, { toggle }] = useDisclosure(false);
  return (
    <div className={styles.step}>
      <Block>
        <Group gap="xs">
          <Anchor component="button" size="sm" fw={600} aria-expanded={open} onClick={toggle}>
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
        <Fold title="System prompt" hint={`${system.length.toLocaleString()} chars`}>
          <Code block className={styles.preText}>
            {system}
          </Code>
        </Fold>
      )}
      {items.length > 0 && (
        <Fold title="Context before the first turn" hint={`${items.length} entries`}>
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
        <Anchor component="button" size="xs" aria-expanded={open} onClick={toggle}>
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

/** Vertical block scheme of a run: prompt, each model turn with its tool calls, result. */
export function TraceFlow({ trace }: { trace: Trace }) {
  const m = trace.metrics;
  return (
    <div className={styles.flow}>
      {trace.preamble && <Preamble preamble={trace.preamble} />}
      {trace.prompt && (
        <div className={styles.step}>
          <Block>
            <Text size="xs" c="dimmed">
              Prompt
            </Text>
            <Excerpt text={trace.prompt} lines={8} size="sm" />
          </Block>
        </div>
      )}
      <Flow turns={trace.turns} />
      <div className={styles.step}>
        <Block color={m.isError ? 'red' : undefined}>
          <Text size="sm" fw={600}>
            Result
          </Text>
          <Text size="xs" c="dimmed">
            {m.numTurns ?? trace.turns.length} turns · {cost(m.costUsd)} · {seconds(m.durationMs)}
            {m.toolErrors > 0 && ` · ${m.toolErrors} tool errors`}
            {m.permissionDenials > 0 && ` · ${m.permissionDenials} permission denials`}
          </Text>
        </Block>
      </div>
    </div>
  );
}
