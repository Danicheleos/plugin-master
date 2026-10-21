import { Anchor, Badge, Code, Collapse, Group, Modal, SegmentedControl, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useState } from 'react';
import type { Trace, TraceMetrics, TraceToolUse, TraceTurn } from '@pm/protocol';
import { useEvalTrace, type TraceTarget } from './hooks';
import { MetricChart } from './MetricChart';
import { TraceFlow } from './TraceFlow';
import { cost, seconds, tokens } from './format';
import styles from './evals.module.scss';

/** One line of numbers about a traced run. */
export function MetricsLine({ m }: { m: TraceMetrics }) {
  const subs = m.subagents.length;
  return (
    <Text size="xs" c="dimmed">
      {m.numTurns ?? '-'} turns · {m.modelCalls} model calls · {m.toolCallsTotal} tool calls · max context{' '}
      {tokens(m.maxContext)} · {seconds(m.durationMs)} wall / {seconds(m.durationApiMs)} API · trace cost{' '}
      {cost(m.costUsd)}
      {subs > 0 && ` · ${subs} subagent${subs > 1 ? 's' : ''}`}
      {m.toolErrors > 0 && ` · ${m.toolErrors} tool errors`}
      {m.permissionDenials > 0 && ` · ${m.permissionDenials} denied`}
    </Text>
  );
}

function ToolUse({ t }: { t: TraceToolUse }) {
  const [open, { toggle }] = useDisclosure(false);
  return (
    <div className={styles.tool}>
      <Group gap="xs">
        <Anchor component="button" size="sm" onClick={toggle} aria-expanded={open}>
          {open ? '▾' : '▸'} {t.name}
        </Anchor>
        {t.result?.isError && <Badge color="red">error</Badge>}
        <Text size="xs" c="dimmed" truncate maw={420}>
          {t.input}
        </Text>
      </Group>
      <Collapse expanded={open}>
        <Code block fz="xs">
          {t.input}
        </Code>
        {t.result && (
          <Code block fz="xs" c={t.result.isError ? 'red' : undefined}>
            {t.result.preview || '(empty)'}
          </Code>
        )}
      </Collapse>
      {t.turns && <Turns turns={t.turns} nested />}
    </div>
  );
}

function Turns({ turns, nested }: { turns: TraceTurn[]; nested?: boolean }) {
  return (
    <ol className={nested ? styles.nested : styles.turns}>
      {turns.map((t, i) => (
        <li key={t.id}>
          <Group gap="xs">
            <Text size="sm" fw={600}>
              #{i + 1}
            </Text>
            <Text size="xs" c="dimmed">
              context {tokens(t.context)} · out {tokens(t.outputTokens)}
            </Text>
          </Group>
          {t.thinking && (
            <Text size="xs" c="dimmed" fs="italic" className={styles.excerpt}>
              {t.thinking}
            </Text>
          )}
          {t.text && (
            <Text size="sm" className={styles.excerpt}>
              {t.text}
            </Text>
          )}
          {t.tools.map((tool) => (
            <ToolUse key={tool.id} t={tool} />
          ))}
        </li>
      ))}
    </ol>
  );
}

/** Modal around a trace; the caller fetches it. */
export function TraceDialog({
  title,
  trace,
  error,
  onClose,
}: {
  title: string;
  trace?: Trace;
  error?: Error | null;
  onClose: () => void;
}) {
  const [view, setView] = useState('flow');
  return (
    <Modal opened onClose={onClose} size="90%" title={title}>
      {error && <Text c="red">{error.message}</Text>}
      {trace && (
        <>
          <MetricsLine m={trace.metrics} />
          <Text size="xs" c="dimmed">
            {trace.metrics.model ?? ''} · tokens in {tokens(trace.metrics.inputTokens)} · out{' '}
            {tokens(trace.metrics.outputTokens)} · cache read {tokens(trace.metrics.cacheReadTokens)} · cache write{' '}
            {tokens(trace.metrics.cacheCreationTokens)}
            {trace.metrics.badLines > 0 && ` · ${trace.metrics.badLines} unreadable lines`}
          </Text>
          <MetricChart
            points={trace.turns.map((t, i) => ({ key: String(i), value: t.context, title: `call ${i + 1}: ${tokens(t.context)}` }))}
            label="Context per model call"
            format={tokens}
          />
          <SegmentedControl
            size="xs"
            mt="xs"
            value={view}
            onChange={setView}
            data={[
              { value: 'flow', label: 'Flow' },
              { value: 'log', label: 'Log' },
            ]}
          />
          {view === 'flow' ? <TraceFlow trace={trace} /> : <Turns turns={trace.turns} />}
        </>
      )}
    </Modal>
  );
}

export function TraceModal({ spaceId, target, onClose }: { spaceId: string; target: TraceTarget; onClose: () => void }) {
  const { data, error } = useEvalTrace(spaceId, target);
  return (
    <TraceDialog
      title={`Trace: ${target.case} (${target.arm} ${target.n})`}
      trace={data}
      error={error}
      onClose={onClose}
    />
  );
}
