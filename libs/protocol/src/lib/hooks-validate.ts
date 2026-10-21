import {
  HANDLER_TYPES, HOOK_EVENTS, MATCHERLESS_EVENTS, TOOL_EVENTS,
  type HookProblem, type HookSource,
} from './hooks.js';

const REQUIRED: Record<string, string[]> = {
  command: ['command'], http: ['url'], mcp_tool: ['server', 'tool'], prompt: ['prompt'], agent: ['prompt'],
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function checkMatcher(matcher: string, event: string, path: string, out: HookProblem[]) {
  if (MATCHERLESS_EVENTS.includes(event)) {
    out.push({ path, message: `${event} ignores matchers; the hook always fires` });
    return;
  }
  if (/^[\w\-\s,|]*$/.test(matcher) || matcher === '*') return; // all / exact / list
  try {
    new RegExp(matcher);
  } catch (e) {
    // V8's message already starts with "Invalid regular expression: /…/:"
    out.push({ path, message: (e as Error).message });
    return;
  }
  if (matcher.includes(','))
    out.push({ path, message: 'Matcher is treated as a regex, so "," is literal; separate names with "|"' });
  if (/[\w](\*)/.test(matcher))
    out.push({ path, message: 'Matcher is a regex, not a glob; use ".*" instead of "*"' });
}

/** Checks one matcher group of `event` in `source`; `path` is relative to the group. */
export function validateGroup(source: HookSource, event: string, group: unknown): HookProblem[] {
  const out: HookProblem[] = [];
  if (!(HOOK_EVENTS as readonly string[]).includes(event)) out.push({ path: '', message: `Unknown event "${event}"` });
  if (!isRecord(group)) return [...out, { path: '', message: 'Matcher group must be an object' }];
  if (group.matcher !== undefined) {
    if (typeof group.matcher !== 'string') out.push({ path: 'matcher', message: 'matcher must be a string' });
    else checkMatcher(group.matcher, event, 'matcher', out);
  }
  if (!Array.isArray(group.hooks)) return [...out, { path: 'hooks', message: 'hooks must be an array' }];
  if (group.hooks.length === 0) out.push({ path: 'hooks', message: 'hooks must not be empty' });
  group.hooks.forEach((h, i) => {
    const p = `hooks[${i}]`;
    if (!isRecord(h)) return void out.push({ path: p, message: 'Handler must be an object' });
    const type = h.type;
    if (typeof type !== 'string' || !(HANDLER_TYPES as readonly string[]).includes(type)) {
      out.push({ path: `${p}.type`, message: `Unknown handler type ${JSON.stringify(type)}` });
    } else {
      for (const f of REQUIRED[type] ?? [])
        if (typeof h[f] !== 'string' || h[f] === '')
          out.push({ path: `${p}.${f}`, message: `${type} handler requires "${f}"` });
    }
    if (h.timeout !== undefined && !(typeof h.timeout === 'number' && Number.isFinite(h.timeout) && h.timeout > 0))
      out.push({ path: `${p}.timeout`, message: 'timeout must be a positive number of seconds' });
    if (h.if !== undefined) {
      if (typeof h.if !== 'string') out.push({ path: `${p}.if`, message: 'if must be a string' });
      else if (!TOOL_EVENTS.includes(event))
        out.push({ path: `${p}.if`, message: `"if" only works on tool events; on ${event} the hook never runs` });
    }
    if (h.once !== undefined && source !== 'skill')
      out.push({ path: `${p}.once`, message: '"once" is only honored in skill frontmatter' });
  });
  return out;
}
