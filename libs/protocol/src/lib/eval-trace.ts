import { z } from 'zod';

/** One subagent (Task/Agent tool use), from `system task_*` messages and the tool use itself. */
export const TraceSubagentSchema = z.object({
  toolUseId: z.string(),
  description: z.string().optional(),
  subagentType: z.string().optional(),
  status: z.string().optional(),
  totalTokens: z.number().optional(),
  toolUses: z.number().optional(),
  durationMs: z.number().optional(),
});
export type TraceSubagent = z.infer<typeof TraceSubagentSchema>;

export const TraceMetricsSchema = z.object({
  model: z.string().optional(),
  /** Distinct API calls of the main agent (`message.id`). */
  modelCalls: z.number(),
  /** API calls made inside subagents. */
  subagentModelCalls: z.number(),
  /** Tool calls by name, main agent and subagents together. */
  toolCalls: z.record(z.string(), z.number()),
  toolCallsTotal: z.number(),
  toolErrors: z.number(),
  subagents: z.array(TraceSubagentSchema),
  /** Context size (input + cache read + cache creation) of the largest / last main-agent call. */
  maxContext: z.number(),
  finalContext: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheCreationTokens: z.number(),
  /** `result` message. */
  numTurns: z.number().optional(),
  costUsd: z.number().optional(),
  durationMs: z.number().optional(),
  durationApiMs: z.number().optional(),
  isError: z.boolean().optional(),
  permissionDenials: z.number(),
  /** Lines of the file that were not valid JSON. */
  badLines: z.number(),
});
export type TraceMetrics = z.infer<typeof TraceMetricsSchema>;

export type TraceToolUse = {
  id: string;
  name: string;
  /** JSON of the input, cut to 2 KB. */
  input: string;
  result?: { preview: string; isError: boolean };
  /** Turns of the subagent this tool call started. */
  turns?: TraceTurn[];
};
export type TraceTurn = {
  /** `message.id` of the API call. */
  id: string;
  context: number;
  outputTokens: number;
  text?: string;
  thinking?: string;
  tools: TraceToolUse[];
};

const TraceToolUseSchema: z.ZodType<TraceToolUse> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    input: z.string(),
    result: z.object({ preview: z.string(), isError: z.boolean() }).optional(),
    turns: z.array(TraceTurnSchema).optional(),
  }),
);
const TraceTurnSchema: z.ZodType<TraceTurn> = z.lazy(() =>
  z.object({
    id: z.string(),
    context: z.number(),
    outputTokens: z.number(),
    text: z.string().optional(),
    thinking: z.string().optional(),
    tools: z.array(TraceToolUseSchema),
  }),
);

export const TraceSchema = z.object({
  metrics: TraceMetricsSchema,
  turns: z.array(TraceTurnSchema),
  /** First user message (the run's prompt), cut to 16 KB. */
  prompt: z.string().optional(),
  /** What the trace records before the first model call (not every trace has all of it). */
  preamble: z
    .object({
      /** The system prompt, when the trace stores it (Claude Code transcripts do, eval traces do not). */
      system: z.string().optional(),
      /** Init info, hooks, attachments and user messages before the first turn, in order. */
      items: z.array(z.object({ kind: z.string(), text: z.string() })),
    })
    .optional(),
});
export type Trace = z.infer<typeof TraceSchema>;
