import type {
  Trace,
  TraceMetrics,
  TraceSubagent,
  TraceToolUse,
  TraceTurn,
} from '@pm/protocol';
import { cut } from '../lib/text';

// generous caps: the Flow view expands texts in place, so only pathological blobs are cut
const PREVIEW_CHARS = 16_000;
const EXCERPT_CHARS = 16_000;
const SYSTEM_CHARS = 200_000;
const MAX_PREAMBLE = 300;
const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

type Block = { type?: string; [k: string]: unknown };
type Msg = {
  type?: string;
  subtype?: string;
  parent_tool_use_id?: string | null;
  message?: { id?: string; content?: unknown; usage?: Usage };
  [k: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

const blocksOf = (content: unknown): Block[] =>
  Array.isArray(content) ? (content as Block[]) : [];

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  return blocksOf(content)
    .map((b) => (b.type === 'text' ? String(b.text ?? '') : ''))
    .join('');
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const contextOf = (u: Usage = {}) =>
  num(u.input_tokens) +
  num(u.cache_read_input_tokens) +
  num(u.cache_creation_input_tokens);

const pretty = (v: unknown) => cut(typeof v === 'string' ? v : JSON.stringify(v, null, 2) ?? '', EXCERPT_CHARS);

/** One entry before the first model call (init, hook output, attachment, user message); null for noise. */
function preambleItem(m: Msg): { kind: string; text: string } | null {
  if (m.type === 'system') {
    if (m.subtype === 'init') {
      const { type: _t, subtype: _s, uuid: _u, session_id: _i, ...info } = m;
      return { kind: 'init', text: pretty(info) };
    }
    if (m.subtype === 'hook_response') {
      const out = String(m.output ?? m.stdout ?? '').trim();
      return out && out !== '{}' ? { kind: `hook ${m.hook_name ?? ''}`.trim(), text: cut(out, EXCERPT_CHARS) } : null;
    }
    return null;
  }
  if (m.type === 'attachment' && m.attachment && typeof m.attachment === 'object') {
    const { type, text, content, ...rest } = m.attachment as Record<string, unknown>;
    const body = text ?? content ?? (Object.keys(rest).length ? rest : '');
    return { kind: String(type ?? 'attachment'), text: pretty(body) };
  }
  if (m.type === 'user' && m.parent_tool_use_id == null) {
    const text = textOf(m.message?.content).trim();
    return text ? { kind: m.isMeta ? 'user (meta)' : 'user', text: cut(text, EXCERPT_CHARS) } : null;
  }
  return null;
}

/**
 * Parses a stream-json trace (SDK messages, one per line) of an eval run. Pure; the only
 * place that knows the trace shape. Bad lines are counted, not fatal.
 */
export function parseTrace(text: string): Trace {
  const byParent = new Map<string | null, TraceTurn[]>();
  const turnById = new Map<string, TraceTurn>();
  const usageByTurn = new Map<TraceTurn, Usage>();
  const toolById = new Map<string, TraceToolUse>();
  const subagents = new Map<string, TraceSubagent>();
  const toolCalls: Record<string, number> = {};
  let toolErrors = 0;
  let badLines = 0;
  let model: string | undefined;
  let result: Msg | undefined;
  let prompt: string | undefined;
  let system: string | undefined;
  const items: { kind: string; text: string }[] = [];
  let started = false; // the first top-level model call ends the preamble

  const subagent = (id: string) => {
    let s = subagents.get(id);
    if (!s) subagents.set(id, (s = { toolUseId: id }));
    return s;
  };

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let m: Msg;
    try {
      m = JSON.parse(line) as Msg;
    } catch {
      badLines++;
      continue;
    }
    if (!m || typeof m !== 'object') continue;
    const parent = m.parent_tool_use_id ?? null;

    if (m.type === 'assistant' && parent === null) started = true;
    if (m.type === 'attachment' && m.attachment?.type === 'prompt_snapshot' && system === undefined) {
      const sp = m.attachment.systemPrompt;
      system = cut(Array.isArray(sp) ? sp.map(String).join('\n\n---\n\n') : String(sp ?? ''), SYSTEM_CHARS);
    } else if (!started && items.length < MAX_PREAMBLE) {
      const item = preambleItem(m);
      if (item) items.push(item);
    }

    if (m.type === 'assistant' && m.message) {
      const id = m.message.id ?? (typeof m.uuid === 'string' ? m.uuid : `line-${turnById.size}`);
      let turn = turnById.get(id);
      if (!turn) {
        turn = { id, context: 0, outputTokens: 0, tools: [] };
        turnById.set(id, turn);
        byParent.set(parent, [...(byParent.get(parent) ?? []), turn]);
      }
      // entries of one API call repeat its usage; the last one is the final value
      if (m.message.usage) usageByTurn.set(turn, m.message.usage);
      for (const b of blocksOf(m.message.content)) {
        if (b.type === 'text' && b.text) turn.text = (turn.text ?? '') + String(b.text);
        else if (b.type === 'thinking' && b.thinking)
          turn.thinking = (turn.thinking ?? '') + String(b.thinking);
        else if (b.type === 'tool_use' && !toolById.has(String(b.id))) {
          const tool: TraceToolUse = {
            id: String(b.id),
            name: String(b.name),
            input: cut(JSON.stringify(b.input ?? null), PREVIEW_CHARS),
          };
          toolById.set(tool.id, tool);
          turn.tools.push(tool);
          toolCalls[tool.name] = (toolCalls[tool.name] ?? 0) + 1;
          if (SUBAGENT_TOOLS.has(tool.name)) subagent(tool.id);
        }
      }
    } else if (m.type === 'user') {
      const said = parent === null && prompt === undefined ? textOf(m.message?.content).trim() : '';
      if (said) prompt = cut(said, EXCERPT_CHARS);
      for (const b of blocksOf(m.message?.content)) {
        const tool = b.type === 'tool_result' ? toolById.get(String(b.tool_use_id)) : undefined;
        if (!tool) continue;
        const isError = b.is_error === true;
        tool.result = { preview: cut(textOf(b.content), PREVIEW_CHARS), isError };
        if (isError) toolErrors++;
      }
    } else if (m.type === 'system') {
      if (m.subtype === 'init') model = typeof m.model === 'string' ? m.model : model;
      else if (typeof m.tool_use_id === 'string' && m.subtype?.startsWith('task_')) {
        const s = subagent(m.tool_use_id);
        if (m.subtype === 'task_started') {
          s.description = m.description;
          s.subagentType = m.subagent_type;
        } else if (m.subtype === 'task_progress') {
          s.totalTokens = m.usage?.total_tokens;
          s.toolUses = m.usage?.tool_uses;
          s.durationMs = m.usage?.duration_ms;
        } else if (m.subtype === 'task_notification') s.status = m.status;
      }
    } else if (m.type === 'result') result = m;
  }

  for (const [turn, usage] of usageByTurn) {
    turn.context = contextOf(usage);
    turn.outputTokens = num(usage.output_tokens);
  }
  for (const turn of turnById.values()) {
    if (turn.text) turn.text = cut(turn.text, EXCERPT_CHARS);
    if (turn.thinking) turn.thinking = cut(turn.thinking, EXCERPT_CHARS);
    for (const tool of turn.tools) {
      const sub = byParent.get(tool.id);
      if (sub) tool.turns = sub;
    }
  }

  const top = byParent.get(null) ?? [];
  const all = [...turnById.values()];
  const sum = (f: (u: Usage) => number) =>
    all.reduce((n, t) => n + f(usageByTurn.get(t) ?? {}), 0);
  const ru = (result?.usage ?? {}) as Usage;
  const total = (key: keyof Usage, calc: (u: Usage) => number) =>
    result?.usage ? num(ru[key]) : sum(calc);
  const contexts = top.map((t) => t.context);

  const metrics: TraceMetrics = {
    model,
    modelCalls: top.length,
    subagentModelCalls: all.length - top.length,
    toolCalls,
    toolCallsTotal: Object.values(toolCalls).reduce((a, b) => a + b, 0),
    toolErrors,
    subagents: [...subagents.values()],
    maxContext: Math.max(0, ...contexts),
    finalContext: contexts.at(-1) ?? 0,
    inputTokens: total('input_tokens', (u) => num(u.input_tokens)),
    outputTokens: total('output_tokens', (u) => num(u.output_tokens)),
    cacheReadTokens: total('cache_read_input_tokens', (u) => num(u.cache_read_input_tokens)),
    cacheCreationTokens: total('cache_creation_input_tokens', (u) =>
      num(u.cache_creation_input_tokens),
    ),
    numTurns: result?.num_turns,
    costUsd: result?.total_cost_usd,
    durationMs: result?.duration_ms,
    durationApiMs: result?.duration_api_ms,
    isError: result?.is_error,
    permissionDenials: Array.isArray(result?.permission_denials)
      ? result.permission_denials.length
      : 0,
    badLines,
  };
  return {
    metrics,
    turns: top,
    ...(prompt && { prompt }),
    ...((system || items.length) && { preamble: { ...(system && { system }), items } }),
  };
}
