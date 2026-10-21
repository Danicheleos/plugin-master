import type { EvalCase, EvalGroup, EvalResult, EvalRunSummary } from '@pm/protocol';

/** A run starts a new group when it begins more than this after the group's latest end. */
export const GAP_MS = 10 * 60 * 1000;

type RunCase = { name: string; score?: number; runs: number };
export type RunInput = { summary: EvalRunSummary; cases: RunCase[] };

const start = (r: EvalRunSummary) => Date.parse(r.startedAt ?? '');
const end = (r: EvalRunSummary) => start(r) + (r.durationSeconds ?? 0) * 1000;
const kind = (r: EvalRunSummary) =>
  [r.modelOverride ?? null, r.ablation ?? null, r.claudeVersion ?? null, r.pluginVersion ?? null].join('\0');

/** Latest result of each case name (`items` in start order); a case keeps its first position. */
function latestCases<T extends { name: string }>(items: T[]): T[] {
  const byName = new Map<string, T>();
  for (const c of items) byName.set(c.name, c);
  return [...byName.values()];
}

function toGroup(items: RunInput[]): EvalGroup {
  const runs = items.map((i) => i.summary);
  const first = runs[0] as EvalRunSummary;
  const maxEnd = Math.max(...runs.map(end));
  // later runs overwrite earlier ones: each case is judged against its own run's threshold
  const latest = new Map<string, { score?: number; threshold: number }>();
  for (const { summary, cases } of items)
    for (const c of cases)
      latest.set(c.name, { score: c.score, threshold: summary.threshold ?? 1 });
  const scores = [...latest.values()].flatMap((c) => (c.score === undefined ? [] : [c.score]));
  const sum = (f: (r: EvalRunSummary) => number | undefined) =>
    runs.reduce((n, r) => n + (f(r) ?? 0), 0);
  return {
    id: first.id,
    startedAt: first.startedAt,
    endedAt: new Date(maxEnd).toISOString(),
    runIds: runs.map((r) => r.id),
    runs,
    totalRuns: items.reduce((n, i) => n + i.cases.reduce((m, c) => m + c.runs, 0), 0),
    score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined,
    casesPassed: [...latest.values()].filter((c) => c.score !== undefined && c.score >= c.threshold).length,
    casesTotal: latest.size,
    threshold: first.threshold,
    costUsd: sum((r) => r.costUsd),
    durationSeconds: (maxEnd - start(first)) / 1000,
    modelOverride: first.modelOverride,
    ablation: first.ablation,
    claudeVersion: first.claudeVersion,
    pluginVersion: first.pluginVersion,
    partial: runs.some((r) => r.partial) || undefined,
    skippedPaid: runs.some((r) => r.skippedPaid) || undefined,
  };
}

/**
 * Groups runs of one logical eval: sorted by start, a run joins the current group when it
 * starts within `GAP_MS` of the group's latest end (concurrent runs overlap) and has the same
 * model, ablation, Claude and plugin version. Newest group first; broken or undated runs are
 * single entries at the end.
 */
export function groupRuns(inputs: RunInput[]): EvalGroup[] {
  const ok = inputs
    .filter((i) => !i.summary.error && !Number.isNaN(start(i.summary)))
    .sort((a, b) => start(a.summary) - start(b.summary));
  const groups: RunInput[][] = [];
  let maxEnd = 0;
  for (const item of ok) {
    const cur = groups.at(-1);
    const s = item.summary;
    if (cur && start(s) <= maxEnd + GAP_MS && kind(s) === kind((cur[0] as RunInput).summary)) {
      cur.push(item);
      maxEnd = Math.max(maxEnd, end(s));
    } else {
      groups.push([item]);
      maxEnd = end(s);
    }
  }
  const loose = inputs
    .filter((i) => !ok.includes(i))
    .map(({ summary }): EvalGroup => ({
      id: summary.id,
      error: summary.error,
      runIds: [summary.id],
      runs: [summary],
      totalRuns: 0,
    }));
  return [...groups.reverse().map(toGroup), ...loose];
}

/**
 * One result for a group: the latest case per name (tagged with its run), or with `all` every case of
 * every invocation in start order (the viewer). Group aggregates are over the latest per name.
 */
export function mergeGroup(group: EvalGroup, results: Map<string, EvalResult>, all = false): EvalResult {
  const ordered = group.runIds.flatMap((id) => {
    const r = results.get(id);
    return r ? [{ id, r }] : [];
  });
  const first = ordered[0]?.r;
  return {
    schemaVersion: first?.schemaVersion,
    claudeVersion: group.claudeVersion,
    startedAt: group.startedAt,
    durationSeconds: group.durationSeconds,
    costUsd: group.costUsd,
    partial: group.partial,
    partialReason: null,
    suite: first?.suite ?? {},
    cases: (all ? (xs: EvalCase[]) => xs : latestCases)(
      ordered.flatMap(({ id, r }) => r.cases.map((c) => ({ ...c, runId: id }))),
    ),
    aggregates: {
      casesTotal: group.casesTotal,
      casesPassed: group.casesPassed,
      overallScore: group.score,
    },
  };
}
