import type { ChatEvent, TraceToolUse } from '@pm/protocol';

export type ToolEvent = Extract<
  ChatEvent,
  { kind: 'tool_use' | 'tool_result' }
>;
export type Row =
  | { at: number; e: Exclude<ChatEvent, ToolEvent> }
  | { at: number; tools: ToolEvent[] };
/** Subagent tool events by their parent Agent/Task tool use id. */
export type Sub = Map<string, ToolEvent[]>;

export const isTool = (e: ChatEvent): e is ToolEvent =>
  e.kind === 'tool_use' || e.kind === 'tool_result';

/** Groups consecutive tool calls and results; `at` = absolute index of the row's first event (stable key while the window slides). */
export function toRows(events: ChatEvent[], at: number[]): Row[] {
  const rows: Row[] = [];
  events.forEach((e, i) => {
    const last = rows[rows.length - 1];
    if (!isTool(e)) rows.push({ at: at[i], e });
    else if (last && 'tools' in last) last.tools.push(e);
    else rows.push({ at: at[i], tools: [e] });
  });
  return rows;
}

/** Occurrences per name, in order of first appearance. */
function countNames(names: Iterable<string>): [string, number][] {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts];
}

const label = (n: string, c: number, sep: string) =>
  c > 1 ? `${n}${sep}${c}` : n;

/** `3 tool calls: Read ×2, Bash · 1 error` */
export function summary(tools: ToolEvent[]): string {
  const uses = countNames(
    tools.flatMap((t) => (t.kind === 'tool_use' ? [t.name] : [])),
  );
  const total = uses.reduce((a, [, c]) => a + c, 0);
  const names = uses.map(([n, c]) => label(n, c, ' ×'));
  const errors = tools.filter(
    (t) => t.kind === 'tool_result' && t.isError,
  ).length;
  return (
    `${total} tool call${total === 1 ? '' : 's'}` +
    (names.length ? `: ${names.join(', ')}` : '') +
    (errors ? ` · ${errors} error${errors === 1 ? '' : 's'}` : '')
  );
}

/** `Read×2, Bash` */
export const callNames = (calls: TraceToolUse[]) =>
  countNames(calls.map((c) => c.name))
    .map(([n, k]) => label(n, k, '×'))
    .join(', ');

/** Tool calls of a group with their results (by `toolUseId`), as trace tool uses; a result without its call stands alone. */
export function pairTools(tools: ToolEvent[]): TraceToolUse[] {
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

/** Master events with their absolute index (`base` + position), and the subagent tool events (`parentToolUseId`) by parent call. */
export function splitSubagents(
  events: ChatEvent[],
  base: number,
): { master: ChatEvent[]; at: number[]; sub: Sub } {
  const sub: Sub = new Map();
  const master: ChatEvent[] = [];
  const at: number[] = [];
  for (const [i, e] of events.entries()) {
    if (!isTool(e) || !e.parentToolUseId) {
      master.push(e);
      at.push(base + i);
      continue;
    }
    let list = sub.get(e.parentToolUseId);
    if (!list) sub.set(e.parentToolUseId, (list = []));
    list.push(e);
  }
  return { master, at, sub };
}

/** The part of `sub` under these calls, nested subagents included; `seen` stops a parent cycle. */
export function subOf(tools: ToolEvent[], sub: Sub, out: Sub = new Map()): Sub {
  for (const e of tools) {
    if (e.kind !== 'tool_use' || out.has(e.id)) continue;
    const kids = sub.get(e.id);
    if (!kids) continue;
    out.set(e.id, kids);
    subOf(kids, sub, out);
  }
  return out;
}

/** Number of events in a subagent map. */
export function subSize(sub: Sub): number {
  let n = 0;
  for (const kids of sub.values()) n += kids.length;
  return n;
}

/** Number of subagent events under these calls, nested subagents included. */
export const countSub = (tools: ToolEvent[], sub: Sub): number =>
  subSize(subOf(tools, sub));
