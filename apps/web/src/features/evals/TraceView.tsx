import { Badge, Modal, Text } from '@mantine/core';
import type { Trace, TraceMetrics } from '@pm/protocol';
import { useEvalTrace, type TraceTarget } from './hooks';
import { maxPerBucket } from './downsample';
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

/** Context per model call, at most `CHART_POINTS` points (the peak of each bucket of calls). */
const CHART_POINTS = 150;
const contextPoints = (trace: Trace) =>
  maxPerBucket(trace.turns, (t) => t.context, CHART_POINTS).map(
    ({ item, from, to }) => ({
      key: String(from),
      value: item.context,
      title:
        from === to
          ? `call ${from + 1}: ${tokens(item.context)}`
          : `calls ${from + 1}–${to + 1}: max ${tokens(item.context)}`,
    }),
  );

/**
 * The one trace body of every view: metrics, token line, context chart and the flow;
 * `byPrompt` groups the flow by user prompt (session/run traces).
 */
export function TraceBody({
  trace,
  byPrompt,
}: {
  trace: Trace;
  byPrompt?: boolean;
}) {
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
        points={contextPoints(trace)}
        label="Context per model call"
        format={tokens}
      />
      <TraceFlow trace={trace} byPrompt={byPrompt} />
    </>
  );
}

/** Modal around a trace; the caller fetches it. */
export function TraceDialog({
  title,
  trace,
  error,
  onClose,
  byPrompt,
}: {
  title: string;
  trace?: Trace;
  error?: Error | null;
  onClose: () => void;
  /** session/run traces: the flow grouped by user prompt */
  byPrompt?: boolean;
}) {
  return (
    <Modal opened onClose={onClose} size="90%" title={title}>
      {error && <Text c="red">{error.message}</Text>}
      {trace && <TraceBody trace={trace} byPrompt={byPrompt} />}
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
