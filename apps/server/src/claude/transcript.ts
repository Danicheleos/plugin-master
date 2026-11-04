import { lstat, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Trace } from '@pm/protocol';
import { parseTrace } from '../evals/trace';

const SESSION_ID = /^[0-9a-f-]{36}$/i;
const AGENT_FILE = /^agent-[\w-]{1,100}\.jsonl$/;

export const defaultProjectsDir = (home = homedir()) =>
  join(home, '.claude', 'projects');

const isFile = (p: string) =>
  lstat(p).then(
    (s) => s.isFile(),
    () => false,
  );
const lines = (text: string) => text.split('\n').filter((l) => l.trim());

/** `<projects>/<any>/<id>.jsonl`, the Claude Code transcript of a session; undefined when none. */
async function findTranscript(
  projects: string,
  sessionId: string,
): Promise<string | undefined> {
  for (const d of await readdir(projects).catch(() => [] as string[])) {
    const file = join(projects, d, `${sessionId}.jsonl`);
    if (await isFile(file)) return file;
  }
  return undefined;
}

/**
 * Lines of each `<id>/subagents/agent-*.jsonl`, tagged with the parent Agent call from its
 * `agent-*.meta.json` (`toolUseId`, undocumented format) and led by a synthetic `task_started`
 * carrying the agent's type and description. A file without a usable meta is skipped.
 */
async function subagentLines(transcript: string): Promise<string[]> {
  const dir = join(transcript.replace(/\.jsonl$/, ''), 'subagents');
  const out: string[] = [];
  for (const name of (await readdir(dir).catch(() => [] as string[]))
    .filter((n) => AGENT_FILE.test(n))
    .sort()) {
    const file = join(dir, name);
    if (!(await isFile(file))) continue;
    const meta = await readFile(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')
      .then((t) => JSON.parse(t) as Record<string, unknown>)
      .catch(() => undefined);
    const toolUseId = meta?.toolUseId;
    if (typeof toolUseId !== 'string') continue;
    out.push(
      JSON.stringify({
        type: 'system',
        subtype: 'task_started',
        tool_use_id: toolUseId,
        ...(typeof meta?.description === 'string' && {
          description: meta.description,
        }),
        ...(typeof meta?.agentType === 'string' && {
          subagent_type: meta.agentType,
        }),
      }),
    );
    for (const line of lines(await readFile(file, 'utf8'))) {
      try {
        out.push(
          JSON.stringify({
            ...JSON.parse(line),
            parent_tool_use_id: toolUseId,
          }),
        );
      } catch {
        out.push(line); // counted as a bad line by parseTrace
      }
    }
  }
  return out;
}

type Line = Record<string, unknown>;
const total = (rs: Line[], key: string) =>
  rs.reduce((n, r) => n + (typeof r[key] === 'number' ? r[key] : 0), 0);

/**
 * The recorded run's lines for the trace: `head` = its `system` lines before the first model call
 * (init, hook output: the preamble, so they go before the transcript), `tail` = the later `system`
 * lines (task status) plus one synthetic `result` folding every prompt's result (turns and
 * durations summed, cost = `meta.json` `costUsd`, which carries the pre-resume base, else the last
 * result's; no `usage`, so `parseTrace` sums the tokens of the de-duplicated turns).
 */
async function recordedLines(
  path: string,
): Promise<{ head: string[]; tail: string[] }> {
  const head: string[] = [];
  const tail: string[] = [];
  const results: Line[] = [];
  let started = false;
  for (const l of lines(await readFile(path, 'utf8'))) {
    let m: Line;
    try {
      m = JSON.parse(l) as Line;
    } catch {
      continue;
    }
    if (m?.type === 'assistant') started = true;
    else if (m?.type === 'system') (started ? tail : head).push(l);
    else if (m?.type === 'result') results.push(m);
  }
  const last = results.at(-1);
  if (last) {
    const metaCost = await readFile(join(dirname(path), 'meta.json'), 'utf8')
      .then((t) => (JSON.parse(t) as Line).costUsd)
      .catch(() => undefined);
    tail.push(
      JSON.stringify({
        type: 'result',
        subtype: last.subtype,
        is_error: last.is_error,
        num_turns: total(results, 'num_turns'),
        duration_ms: total(results, 'duration_ms'),
        duration_api_ms: total(results, 'duration_api_ms'),
        total_cost_usd:
          typeof metaCost === 'number' ? metaCost : last.total_cost_usd,
        permission_denials: results.flatMap((r) =>
          Array.isArray(r.permission_denials) ? r.permission_denials : [],
        ),
      }),
    );
  }
  return { head, tail };
}

/**
 * The one trace of a Claude session, for Runs and "Open trace file" alike: the transcript under
 * `projects` (system prompt, preamble), its subagents as nested lanes, plus the recorded run's
 * totals when `recorded` (a run's messages.jsonl) is given. Undefined when no transcript exists.
 */
export async function readSessionTrace(
  sessionId: string,
  recorded?: string,
  projects = defaultProjectsDir(),
): Promise<Trace | undefined> {
  if (!SESSION_ID.test(sessionId)) return undefined;
  const transcript = await findTranscript(projects, sessionId);
  if (!transcript) return undefined;
  const run = recorded ? await recordedLines(recorded) : { head: [], tail: [] };
  const all = [
    ...run.head,
    ...lines(await readFile(transcript, 'utf8')),
    ...(await subagentLines(transcript)),
    ...run.tail,
  ];
  return parseTrace(all.join('\n'));
}
