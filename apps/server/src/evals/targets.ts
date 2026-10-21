import { readdir, readFile } from 'node:fs/promises';
import type {
  EvalCaseEntry,
  EvalCaseRun,
  EvalSuiteCase,
  EvalSuiteEntry,
  EvalTarget,
  EvalTargetsResponse,
} from '@pm/protocol';
import { resolveInSpace } from '../files/safe-path';
import { readSuite } from './suite';
import { listSuites } from './results';
import { contextBytes } from '../versions/logic';

type Kind = 'skill' | 'agent';
export type Mapping = {
  targets: { kind: Kind; name: string; cases: string[] }[];
  unmapped: string[];
};

/**
 * The plain name a `tool_used` `input_match` regex names, e.g. `"skill"\s*:\s*"(?:[\w-]+:)?foo"`,
 * `"subagent_type":"foo"` or just `foo`; anything more complex (alternations, classes) gives undefined.
 */
export function nameInMatch(pattern: string): string | undefined {
  const s = pattern
    .replace(/\(\?:\[\\w-\]\+:\)\?/g, '')
    .replace(/\\s\*/g, '')
    .replace(/\\"/g, '"')
    .replace(/\\([-.:])/g, '$1');
  return /^(?:"(?:skill|subagent_type)":)?"?(?:[\w-]+:)?([\w-]+)"?$/.exec(
    s,
  )?.[1];
}

const AGENT_TOOLS = new Set(['agent', 'task']);

/** Skills/agents a case is aimed at, in priority order of the rules (graders, then tags, then name). */
function targetsOf(
  c: EvalSuiteCase,
  skills: Set<string>,
  agents: Set<string>,
): `${Kind}:${string}`[] {
  const found = new Set<`${Kind}:${string}`>();
  for (const g of c.toolGraders ?? []) {
    const name = g.inputMatch && nameInMatch(g.inputMatch);
    if (!name) continue;
    const tool = g.tool.toLowerCase();
    if (tool === 'skill' && skills.has(name)) found.add(`skill:${name}`);
    else if (AGENT_TOOLS.has(tool) && agents.has(name))
      found.add(`agent:${name}`);
  }
  for (const t of c.tags) {
    const m = /^(skill|agent):(.+)$/.exec(t);
    if (m) found.add(`${m[1] as Kind}:${m[2] as string}`);
  }
  if (found.size) return [...found];
  // fallback: the longest existing skill/agent name that equals or prefixes the case name or its dir name
  const labels = [c.name, c.dir.split('/').pop() ?? ''];
  const hit = [
    ...[...skills].map((name) => ({ kind: 'skill' as Kind, name })),
    ...[...agents].map((name) => ({ kind: 'agent' as Kind, name })),
  ]
    .filter(({ name }) =>
      labels.some(
        (l) =>
          l === name ||
          new RegExp(
            `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[-_./ ]`,
          ).test(l),
      ),
    )
    .sort((a, b) => b.name.length - a.name.length)[0];
  return hit ? [`${hit.kind}:${hit.name}`] : [];
}

/** Pure: assigns every case to the skills/agents it targets (a case may have several) or to `unmapped`. */
export function mapCases(
  cases: EvalSuiteCase[],
  skills: string[],
  agents: string[],
): Mapping {
  const sk = new Set(skills);
  const ag = new Set(agents);
  const by = new Map<string, Mapping['targets'][number]>();
  const unmapped: string[] = [];
  for (const c of cases) {
    const ts = targetsOf(c, sk, ag);
    if (!ts.length) unmapped.push(c.name);
    for (const t of ts) {
      const i = t.indexOf(':');
      const e = by.get(t) ?? {
        kind: t.slice(0, i) as Kind,
        name: t.slice(i + 1),
        cases: [],
      };
      if (!e.cases.includes(c.name)) e.cases.push(c.name);
      by.set(t, e);
    }
  }
  const targets = [...by.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  );
  return { targets, unmapped };
}

type Metrics = NonNullable<EvalCaseRun['baselineMetrics']>;
const KEYS = [
  'score',
  'passRate',
  'costUsd',
  'turns',
  'maxContext',
  'tokens',
  'durationMs',
] as const;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Per metric over the defined values: mean per case, except `maxContext` = max. */
function aggregate(rows: Metrics[]): Metrics {
  const out: Metrics = {};
  for (const k of KEYS) {
    const vs = rows.flatMap((r) =>
      r[k] === undefined ? [] : [r[k] as number],
    );
    if (vs.length) out[k] = k === 'maxContext' ? Math.max(...vs) : mean(vs);
  }
  return out;
}

/** Every run of one case in the main suites (one row per run id), newest first (pure). */
export const caseRuns = (
  suites: EvalSuiteEntry[],
  name: string,
): EvalCaseRun[] => aggregateRuns(suites, [name]);

/** Cases that have runs in a main suite; the other suites only supply cases that exist nowhere else (baseline-only cases). */
const mainCases = (suites: EvalSuiteEntry[]) =>
  new Set(
    suites
      .filter((s) => s.kind === 'main')
      .flatMap((s) => s.cases.map((c) => c.name)),
  );

/** One row per run id over the given cases (main suites, else the suites that hold the case), newest first (pure). */
export function aggregateRuns(
  suites: EvalSuiteEntry[],
  caseNames: string[],
): EvalCaseRun[] {
  const wanted = new Set(caseNames);
  const inMain = mainCases(suites);
  const byRun = new Map<string, EvalCaseRun[]>();
  const seen = new Set<string>();
  for (const s of suites)
    for (const c of s.cases as EvalCaseEntry[])
      if (wanted.has(c.name) && (s.kind === 'main' || !inMain.has(c.name)))
        for (const sec of c.sections)
          for (const r of sec.runs) {
            const k = `${r.runId}\0${c.name}`;
            if (seen.has(k)) continue;
            seen.add(k);
            byRun.set(r.runId, [...(byRun.get(r.runId) ?? []), r]);
          }
  const rows = [...byRun.entries()].map(([runId, rs]): EvalCaseRun => {
    const first = rs[0] as EvalCaseRun;
    const m = aggregate(rs);
    const withBase = rs.filter((r) => r.baselineMetrics);
    const baselineMetrics = withBase.length
      ? aggregate(withBase.map((r) => r.baselineMetrics as Metrics))
      : undefined;
    return {
      runId,
      startedAt: first.startedAt,
      model: first.model,
      ...m,
      baselineScore: baselineMetrics?.score,
      delta:
        m.score !== undefined && baselineMetrics?.score !== undefined
          ? m.score - baselineMetrics.score
          : undefined,
      commit: first.commit,
      baselineMetrics,
    };
  });
  const t = (r: EvalCaseRun) => Date.parse(r.startedAt ?? '') || 0;
  return rows.sort((a, b) => t(b) - t(a));
}

async function names(
  root: string,
  dir: string,
  pick: (e: import('node:fs').Dirent) => string | undefined,
) {
  const entries = await readdir(resolveInSpace(root, dir), {
    withFileTypes: true,
  }).catch(() => []);
  return entries.flatMap((e) => pick(e) ?? []);
}

/** Same cost as the versions gate (`contextBytes`: description + body). */
const size = (root: string, rel: string) =>
  readFile(resolveInSpace(root, rel), 'utf8').then(
    contextBytes,
    () => undefined,
  );

export async function listTargets(root: string): Promise<EvalTargetsResponse> {
  const [suite, suites, skills, agents] = await Promise.all([
    readSuite(root),
    listSuites(root),
    names(root, 'skills', (e) => (e.isDirectory() ? e.name : undefined)),
    names(root, 'agents', (e) =>
      e.isFile() && e.name.endsWith('.md') ? e.name.slice(0, -3) : undefined,
    ),
  ]);
  const { targets, unmapped } = mapCases(suite.cases, skills, agents);
  // cases with runs but no case file on disk (e.g. generated, gitignored ones): kept visible, never mapped by name
  const onDisk = new Set(suite.cases.map((c) => c.name));
  for (const name of [...mainCases(suites.suites)].sort())
    if (!onDisk.has(name)) unmapped.push(name);
  const runs = (cases: string[]) => aggregateRuns(suites.suites, cases);
  const lastRun = new Map<string, string>();
  const inMain = mainCases(suites.suites);
  for (const s of suites.suites)
    for (const c of s.cases)
      if (s.kind === 'main' || !inMain.has(c.name))
        lastRun.set(c.name, c.latest.runId);
  const refs = (cases: string[]) =>
    cases.map((name) => ({
      name,
      lastRunId: lastRun.get(name),
      runs: caseRuns(suites.suites, name),
    }));
  return {
    targets: await Promise.all(
      targets.map(
        async (t): Promise<EvalTargetsResponse['targets'][number]> => ({
          ...t,
          cases: refs(t.cases),
          runs: runs(t.cases),
          contextBytes: await size(
            root,
            t.kind === 'skill'
              ? `skills/${t.name}/SKILL.md`
              : `agents/${t.name}.md`,
          ),
        }),
      ),
    ),
    unmapped: {
      name: 'Unmapped',
      cases: refs(unmapped),
      runs: runs(unmapped),
    } satisfies EvalTarget,
  };
}
