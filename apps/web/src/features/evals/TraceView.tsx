import { Badge, Modal, SegmentedControl, Text } from '@mantine/core';
import { useState } from 'react';
import type { Trace, TraceMetrics } from '@pm/protocol';
import { useEvalTrace, type TraceTarget } from './hooks';
import { MetricChart } from './MetricChart';
import { TraceFlow } from './TraceFlow';
import { cost, seconds, tokens } from './format';

/** Numbers about a traced run: totals, then the calls per tool. */
export function MetricsLine({ m }: { m: TraceMetrics }) {
  const subs = m.subagents.length;
  const perTool = Object.entries(m.toolCalls).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <Text size="xs" c="dimmed">
        {m.isError && (
          <Badge color="red" size="xs" mr={4}>
            error
          </Badge>
        )}
        {m.numTurns ?? '-'} turns · {m.modelCalls} model calls
        {m.subagentModelCalls > 0 &&
          ` (+${m.subagentModelCalls} in subagents)`}{' '}
        · {m.toolCallsTotal} tool calls · max context {tokens(m.maxContext)} ·
        final context {tokens(m.finalContext)} · {seconds(m.durationMs)} wall /{' '}
        {seconds(m.durationApiMs)} API · trace cost {cost(m.costUsd)}
        {subs > 0 && ` · ${subs} subagent${subs > 1 ? 's' : ''}`}
        {m.toolErrors > 0 && ` · ${m.toolErrors} tool errors`}
        {m.permissionDenials > 0 && ` · ${m.permissionDenials} denied`}
      </Text>
      {perTool.length > 0 && (
        <Text size="xs" c="dimmed" aria-label="tool calls">
          {perTool.map(([name, n]) => `${name} ${n}`).join(' · ')}
        </Text>
      )}
    </>
  );
}

/** The one trace body of every view: metrics, token line, context chart and the Flow | Log switch. */
export function TraceBody({ trace }: { trace: Trace }) {
  const [view, setView] = useState('flow');
  const m = trace.metrics;
  return (
    <>
      <MetricsLine m={m} />
      <Text size="xs" c="dimmed">
        {m.model ?? ''} · tokens in {tokens(m.inputTokens)} · out{' '}
        {tokens(m.outputTokens)} · cache read {tokens(m.cacheReadTokens)} ·
        cache write {tokens(m.cacheCreationTokens)}
        {m.badLines > 0 && ` · ${m.badLines} unreadable lines`}
      </Text>
      <MetricChart
        points={trace.turns.map((t, i) => ({
          key: String(i),
          value: t.context,
          title: `call ${i + 1}: ${tokens(t.context)}`,
        }))}
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
      <TraceFlow trace={trace} flat={view === 'log'} />
    </>
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
  return (
    <Modal opened onClose={onClose} size="90%" title={title}>
      {error && <Text c="red">{error.message}</Text>}
      {trace && <TraceBody trace={trace} />}
    </Modal>
  );
}

export function TraceModal({
  spaceId,
  target,
  onClose,
}: {
  spaceId: string;
  target: TraceTarget;
  onClose: () => void;
}) {
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
