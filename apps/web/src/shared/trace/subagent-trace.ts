import type { Trace, TraceToolUse, TraceTurn } from '@pm/protocol';

/** The tool call `id` anywhere in `turns`, subagent turns included. */
function findCall(turns: TraceTurn[], id: string): TraceToolUse | undefined {
  for (const turn of turns)
    for (const t of turn.tools) {
      if (t.id === id) return t;
      const inner = t.turns && findCall(t.turns, id);
      if (inner) return inner;
    }
  return undefined;
}

const promptOf = (input: string): string | undefined => {
  try {
    const p = (JSON.parse(input) as { prompt?: unknown } | null)?.prompt;
    return typeof p === 'string' ? p : undefined;
  } catch {
    return undefined; // the input is cut at 2 KB: not always valid JSON
  }
};

/**
 * Only the subagent started by the Agent/Task call `toolUseId`, as a trace of its own: its turns,
 * its prompt and the metrics its turns give (no token split or cost: the parent trace has those).
 * Undefined while the call is not in the trace yet.
 */
export function subagentTrace(
  trace: Trace,
  toolUseId: string,
): Trace | undefined {
  const call = findCall(trace.turns, toolUseId);
  if (!call) return undefined;
  const turns = call.turns ?? [];
  const tools = turns.flatMap((t) => t.tools);
  const toolCalls: Record<string, number> = {};
  for (const t of tools) toolCalls[t.name] = (toolCalls[t.name] ?? 0) + 1;
  const nested = (ts: TraceTurn[]): number =>
    ts.reduce(
      (n, t) =>
        n +
        t.tools.reduce(
          (k, x) => k + (x.turns ? x.turns.length + nested(x.turns) : 0),
          0,
        ),
      0,
    );
  const info = trace.metrics.subagents.find((s) => s.toolUseId === toolUseId);
  return {
    turns,
    prompt: promptOf(call.input),
    metrics: {
      modelCalls: turns.length,
      subagentModelCalls: nested(turns),
      toolCalls,
      toolCallsTotal: tools.length,
      toolErrors: tools.filter((t) => t.result?.isError).length,
      subagents: trace.metrics.subagents,
      maxContext: Math.max(0, ...turns.map((t) => t.context)),
      finalContext: turns[turns.length - 1]?.context ?? 0,
      inputTokens: 0,
      outputTokens: turns.reduce((n, t) => n + t.outputTokens, 0),
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      numTurns: turns.length,
      durationMs: info?.durationMs,
      isError: call.result?.isError,
      permissionDenials: 0,
      badLines: 0,
    },
  };
}
