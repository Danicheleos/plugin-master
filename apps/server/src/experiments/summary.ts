import type { EvalCase, EvalResult, ExperimentComparison, SuiteDelta, Trace } from '@pm/protocol';
import { mean, readRunTrace } from '../evals/results';
import { caseStats, pairedDelta, suiteDelta } from '../evals/stats';
import { cut } from '../lib/text';

const fmt = (n: number | undefined) => (n === undefined ? 'n/a' : n.toFixed(2));

export const caseScore = (c: EvalCase) => c.aggregates.score ?? mean(c.arms.with.map((r) => r.score));

/** A case with a failed or errored plugin-arm run. */
export const failedCase = (c: EvalCase) => c.arms.with.some((r) => r.passed === false || !!r.error);

/** Score per case plus failed graders with their explanations, at most `limit` chars. */
export function summarizeEval(r: EvalResult, limit = 4000): string {
  const lines = r.cases.flatMap((c) => {
    const failed = new Map<string, string>();
    for (const run of c.arms.with)
      for (const g of run.graders)
        if (g.passed === false && !failed.has(g.name)) failed.set(g.name, g.explanation ?? '');
    return [
      `- ${c.name}: score ${fmt(caseScore(c))}`,
      ...[...failed].map(([name, why]) => `  - failed ${name}: ${cut(why, 240)}`),
    ];
  });
  return cut(lines.join('\n'), limit);
}

export function compare(result: EvalResult, baseline?: { runId: string; result: EvalResult }): ExperimentComparison {
  const base = new Map(baseline?.result.cases.map((c) => [c.name, c]));
  const cases = result.cases.map((c) => {
    const b = base.get(c.name);
    const [h, o] = [caseStats(c.arms.with), b && caseStats(b.arms.with)];
    const score = caseScore(c);
    const baselineScore = b && caseScore(b);
    return {
      case: c.name,
      score,
      baselineScore,
      n: h.n,
      sd: h.sd,
      baselineN: o?.n,
      baselineSd: o?.sd,
      delta: pairedDelta(baselineScore, score),
      flaky: h.flaky || !!o?.flaky,
    };
  });
  return {
    baseline: baseline ? { runId: baseline.runId } : null,
    cases,
    suite: suiteDelta(cases.map((c) => c.delta)),
  };
}

const suiteText = (s: SuiteDelta) =>
  `${s.verdict}${s.mean === undefined ? '' : `, mean delta ${s.mean.toFixed(2)}`}${s.ci ? ` [${s.ci[0].toFixed(2)}, ${s.ci[1].toFixed(2)}]` : ''} over ${s.cases} case(s); do not call an inconclusive result an improvement or a regression`;

export const comparisonText = (c: ExperimentComparison) =>
  [
    c.baseline ? `Baseline: ${c.baseline.runId}` : 'No baseline (the space has no earlier eval of these cases).',
    ...c.cases.map(
      (x) =>
        `- ${x.case}: with change ${fmt(x.score)}, baseline ${fmt(x.baselineScore)}${x.flaky ? ' (flaky: runs disagree)' : ''}`,
    ),
    ...(c.suite ? [`Suite: ${suiteText(c.suite)}`] : []),
  ].join('\n');

/** The tail of a trace: last turns' text and failing tool results. */
export function traceExcerpt(t: Trace, limit = 1200): string {
  const out = t.turns.slice(-6).flatMap((turn) => [
    ...(turn.text ? [`assistant: ${cut(turn.text, 240)}`] : []),
    ...turn.tools.map(
      (u) => `${u.name} ${cut(u.input, 100)}${u.result?.isError ? ` -> ERROR ${cut(u.result.preview, 160)}` : ''}`,
    ),
  ]);
  return cut(out.join('\n'), limit);
}

/** Tail excerpts of the plugin-arm traces of failed cases (`names` limits which), at most `count` cases and `total` chars. */
export async function failedTraces(
  wt: string,
  result: EvalResult,
  { names, count = 5, perCase = 1200, total = 6000 }: { names?: string[]; count?: number; perCase?: number; total?: number } = {},
) {
  const parts = await Promise.all(
    result.cases.filter((c) => failedCase(c) && (!names || names.includes(c.name))).slice(0, count).map(async (c) => {
      try {
        const t = await readRunTrace(wt, c.runId ?? '', { case: c.name, arm: 'with', n: '1' });
        return `### ${c.name}\n${traceExcerpt(t, perCase)}`;
      } catch {
        return '';
      }
    }),
  );
  return parts.filter(Boolean).join('\n\n').slice(0, total);
}
