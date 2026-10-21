import type {
  EvalBaselineSection,
  EvalCaseEntry,
  EvalCaseRun,
  EvalSuiteEntry,
} from '@pm/protocol';

/** What `buildSuites` needs of one result file (see `results.ts` `loadSuiteRuns`). */
type ArmMetrics = NonNullable<EvalCaseRun['baselineMetrics']>;
type SuiteRunCase = ArmMetrics & {
  name: string;
  /** Metrics of the run's own `without` arm, when it has one. */
  without?: ArmMetrics;
};
export type SuiteRun = {
  id: string;
  startedAt?: string;
  model: string | null;
  /** Commit of the run's sidecar. */
  commit?: string;
  plugin?: string;
  /** `cases[].dir`, relative to the plugin root. */
  caseDirs: string[];
  cases: SuiteRunCase[];
};

const TREND = 12;
const pick = ({ score, passRate, costUsd, turns, maxContext, tokens, recall, precision, f1, durationMs }: ArmMetrics): ArmMetrics => ({
  score,
  passRate,
  costUsd,
  turns,
  maxContext,
  tokens,
  recall,
  precision,
  f1,
  durationMs,
});
const time = (r: { startedAt?: string }) => Date.parse(r.startedAt ?? '');

/** Common parent of the case dirs (`evals/cases/a`, `evals/cases/b` -> `evals/cases`). */
export function commonParent(dirs: string[]): string {
  const parents = dirs.map((d) => d.replace(/\/+$/, '').split('/').slice(0, -1));
  const first = parents[0];
  if (!first) return '';
  let n = first.length;
  for (const p of parents) {
    let i = 0;
    while (i < n && p[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n).join('/');
}

/** Suite key = plugin name + eval dir prefix of its cases; also the label. */
export function suiteKey(r: SuiteRun): string {
  const plugin = r.plugin ?? 'unknown';
  const prefix = commonParent(r.caseDirs);
  return prefix ? `${plugin} · ${prefix}` : plugin;
}

type Baseline = { runId: string; startedAt?: string; score: number; metrics: ArmMetrics; model: string | null; at: number };

/** Auto baseline: latest baseline run of the same case and model that started before `at`, else the nearest later one. */
function pickBaseline(cands: Baseline[], model: string | null, at: number) {
  const same = cands.filter((b) => b.model === model);
  const before = same.filter((b) => b.at <= at).sort((a, b) => b.at - a.at)[0];
  if (before) return { b: before, after: false };
  const next = same.sort((a, b) => a.at - b.at)[0];
  return next && { b: next, after: true };
}

const byTimeDesc = (a: EvalCaseRun, b: EvalCaseRun) => time(b) - time(a);

type Picked = (ReturnType<typeof pickBaseline> & { pinned?: boolean }) | undefined;

function sectionsOf(rows: { row: EvalCaseRun; section: string; base?: Picked }[]) {
  const map = new Map<string, EvalBaselineSection>();
  for (const { row, section, base } of rows) {
    let s = map.get(section);
    if (!s) {
      s = { kind: section === 'ablation' ? 'ablation' : base ? 'run' : 'none', runs: [] };
      if (base)
        s.baseline = {
          runId: base.b.runId,
          startedAt: base.b.startedAt,
          score: base.b.score,
          model: base.b.model,
          after: base.after,
          ...(base.pinned && { pinned: true }),
        };
      map.set(section, s);
    }
    s.runs.push(row);
  }
  const out = [...map.values()];
  for (const s of out) s.runs.sort(byTimeDesc);
  return out.sort((a, b) => time(b.runs[0] as EvalCaseRun) - time(a.runs[0] as EvalCaseRun));
}

/**
 * Suites -> cases -> runs grouped by their baseline. Pure. A suite whose plugin is `mainPlugin`
 * is `main`; another suite sharing case names with a main one is a `baseline` (its runs are the
 * baselines of main-suite cases). Duplicate files of one run (same start and suite, e.g. a
 * harness' `plugin.json` copy) count once; the one in a run dir wins.
 * `pins` (case name -> run id) override the auto baseline and the ablation arm of main-suite
 * rows; `refs` label runs without changing any baseline; a pin whose run no longer has the case is reported as `stalePin` and ignored.
 */
export function buildSuites(inputs: SuiteRun[], mainPlugin?: string, pins: Record<string, string> = {}, refs: Record<string, { label: string; runId: string }[]> = {}): EvalSuiteEntry[] {
  const seen = new Map<string, SuiteRun>();
  const runs = inputs
    .filter((r) => !Number.isNaN(time(r)) && r.cases.length > 0)
    .sort((a, b) => Number(a.id.endsWith('.json')) - Number(b.id.endsWith('.json')))
    .filter((r) => {
      const k = `${r.startedAt}\0${suiteKey(r)}`;
      const kept = seen.get(k);
      if (!kept) {
        seen.set(k, r);
        return true;
      }
      // The dropped copy (a harness-written results/*.json) may hold retrieval metrics that the run dir lacks.
      kept.cases = kept.cases.map((c) => {
        const o = r.cases.find((x) => x.name === c.name);
        return { ...c, recall: c.recall ?? o?.recall, precision: c.precision ?? o?.precision, f1: c.f1 ?? o?.f1 };
      });
      return false;
    });
  const suites = new Map<string, SuiteRun[]>();
  for (const r of runs) suites.set(suiteKey(r), [...(suites.get(suiteKey(r)) ?? []), r]);

  const isMain = (rs: SuiteRun[]) => mainPlugin !== undefined && rs[0]?.plugin === mainPlugin;
  const mainNames = new Set(
    [...suites.values()].filter(isMain).flatMap((rs) => rs.flatMap((r) => r.cases.map((c) => c.name))),
  );
  const kindOf = (rs: SuiteRun[]): EvalSuiteEntry['kind'] =>
    isMain(rs) ? 'main' : rs.some((r) => r.cases.some((c) => mainNames.has(c.name))) ? 'baseline' : 'other';

  const baselines = new Map<string, Baseline[]>();
  for (const rs of suites.values())
    if (kindOf(rs) === 'baseline')
      for (const r of rs)
        for (const c of r.cases)
          if (c.score !== undefined)
            baselines.set(c.name, [
              ...(baselines.get(c.name) ?? []),
              { runId: r.id, startedAt: r.startedAt, score: c.score, metrics: pick(c), model: r.model, at: time(r) },
            ]);

  const pinned = new Map<string, Baseline>();
  for (const r of runs)
    for (const c of r.cases)
      if (pins[c.name] === r.id)
        pinned.set(c.name, { runId: r.id, startedAt: r.startedAt, score: c.score as number, metrics: pick(c), model: r.model, at: time(r) });

  const entries = [...suites.entries()].map(([key, rs]): EvalSuiteEntry => {
    const kind = kindOf(rs);
    const byCase = new Map<string, { run: SuiteRun; c: SuiteRunCase }[]>();
    for (const run of rs)
      for (const c of run.cases) byCase.set(c.name, [...(byCase.get(c.name) ?? []), { run, c }]);
    const cases = [...byCase.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, items]): EvalCaseEntry => {
        const rows = items.map(({ run, c }) => {
          const labels = (refs[name] ?? []).filter((x) => x.runId === run.id).map((x) => x.label);
          let baselineScore: number | undefined;
          let baselineMetrics: ArmMetrics | undefined;
          let section = 'none';
          let base: Picked;
          const pin = pinned.get(name);
          if (kind === 'main' && pin) {
            base = { b: pin, after: false, pinned: true };
            baselineScore = pin.score;
            baselineMetrics = pin.metrics;
            section = `pin:${pin.runId}`;
          } else if (kind === 'main' && c.without?.score !== undefined) {
            baselineScore = c.without.score;
            baselineMetrics = pick(c.without);
            section = 'ablation';
          } else if (kind === 'main') {
            base = pickBaseline(baselines.get(name) ?? [], run.model, time(run));
            if (base) {
              baselineScore = base.b.score;
              baselineMetrics = base.b.metrics;
              section = `run:${base.b.runId}:${base.after}`;
            }
          }
          const row: EvalCaseRun = {
            runId: run.id,
            startedAt: run.startedAt,
            model: run.model,
            score: c.score,
            baselineScore,
            delta: c.score !== undefined && baselineScore !== undefined ? c.score - baselineScore : undefined,
            costUsd: c.costUsd,
            turns: c.turns,
            maxContext: c.maxContext,
            tokens: c.tokens,
            recall: c.recall,
            precision: c.precision,
            f1: c.f1,
            durationMs: c.durationMs,
            passRate: c.passRate,
            commit: run.commit,
            ...(pins[name] === run.id && { pinned: true }),
            ...(labels.length && { refs: labels }),
            baselineMetrics,
          };
          return { row, section, base };
        });
        const ordered = rows.map((r) => r.row).sort((a, b) => time(a) - time(b));
        const scores = ordered.flatMap((r) => (r.score === undefined ? [] : [r.score]));
        const latest = ordered[ordered.length - 1] as EvalCaseRun;
        return {
          name,
          runCount: ordered.length,
          lastRunAt: latest.startedAt,
          ...(name in pins && !pinned.has(name) && { stalePin: pins[name] }),
          latest,
          trend: scores.slice(-TREND),
          sections: sectionsOf(rows),
        };
      });
    return { key, label: key, kind, runCount: rs.length, cases };
  });
  const rank = { main: 0, baseline: 1, other: 2 };
  const last = (e: EvalSuiteEntry) => Math.max(...e.cases.map((c) => time({ startedAt: c.lastRunAt })));
  return entries.sort((a, b) => rank[a.kind] - rank[b.kind] || last(b) - last(a));
}
