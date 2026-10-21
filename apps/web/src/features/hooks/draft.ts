import { MATCHERLESS_EVENTS, type Group, type Handler, type HookProblem } from '@pm/protocol';

/** The fields each handler type owns (the form only touches these and `type`). */
export const TYPE_FIELDS: Record<string, string[]> = {
  command: ['command'], http: ['url'], mcp_tool: ['server', 'tool'], prompt: ['prompt'], agent: ['prompt'],
};

/** Copy of `h` with `key` set (an empty value removes it). */
export function setField(h: Handler, key: string, value: unknown): Handler {
  const next = { ...h, [key]: value };
  if (value === '' || value === undefined) delete next[key];
  return next as Handler;
}

/** Copy of `h` with a new type; fields owned only by the old type are dropped. */
export function setType(h: Handler, type: string): Handler {
  const next: Record<string, unknown> = { ...h, type };
  const keep = TYPE_FIELDS[type] ?? [];
  for (const f of TYPE_FIELDS[h.type] ?? []) if (!keep.includes(f)) delete next[f];
  return next as Handler;
}

/** What is validated and saved: no matcher where the event ignores it, no empty matcher. */
export function cleanGroup(g: Group, event: string): Group {
  const next = { ...g };
  if (MATCHERLESS_EVENTS.includes(event) || next.matcher === '') delete next.matcher;
  return next;
}

const FIELD_PATH = /^(matcher|hooks\[\d+\]\.(type|command|url|server|tool|prompt|timeout|if|once))$/;

/** Problems that no input of the form shows (shown as a list under the group). */
export const looseProblems = (ps: HookProblem[]) => ps.filter((p) => !FIELD_PATH.test(p.path));
