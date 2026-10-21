import { useState } from 'react';
import { MultiSelect, Table, Text } from '@mantine/core';
import type { EvalCase, EvalSuiteEntry } from '@pm/protocol';
import { armStats, changedGraders, type ArmStats } from './compare';
import { cost, delta, num, score, stamp, tokens } from './format';
import { useEvalRun, useEvalRuns, useEvalSuites } from './hooks';
import styles from './evals.module.scss';

const ABLATION = '__ablation';
const RUN = 'run:';
/** `initialBaseline` of a compare request: the run's own without arm. */
export const ABLATION_BASELINE = 'ablation';
const diff = (a?: number, b?: number, fmt: (n: number) => string = num) =>
  a === undefined || b === undefined ? '-' : `${a - b > 0 ? '+' : ''}${fmt(a - b)}`;

const METRICS: { label: string; get: (s: ArmStats) => number | undefined; fmt: (n?: number) => string }[] = [
  { label: 'Cost', get: (s) => s.cost, fmt: cost },
  { label: 'Turns', get: (s) => s.turns, fmt: num },
  { label: 'Context', get: (s) => s.maxContext, fmt: tokens },
  { label: 'Model calls', get: (s) => s.modelCalls, fmt: num },
  { label: 'Tool calls', get: (s) => s.toolCalls, fmt: num },
];

/**
 * Per case: this group (with arm) against the without arm of the same run (ablation) or against
 * any number of other runs, one table each. With `focusCase` only runs of that case are offered
 * (from every suite); otherwise groups (e.g. a separate no-plugin suite). Grader verdicts that
 * changed are highlighted. `initialBaseline`: `ABLATION_BASELINE` or the id of a single run.
 */
export function EvalCompare({
  spaceId,
  runId,
  cases,
  initialBaseline,
  focusCase,
}: {
  spaceId: string;
  runId: string;
  cases: EvalCase[];
  initialBaseline?: string;
  focusCase?: string;
}) {
  const hasAblation = cases.some((c) => c.arms.without.length > 0);
  const [choices, setChoices] = useState<string[]>(
    initialBaseline === ABLATION_BASELINE || (!initialBaseline && hasAblation)
      ? [ABLATION]
      : initialBaseline
        ? [RUN + initialBaseline]
        : [],
  );
  const groups = useEvalRuns(spaceId).data?.groups ?? [];
  const suites = useEvalSuites(spaceId).data?.suites;
  const options = [
    ...(hasAblation ? [{ value: ABLATION, label: 'Without the plugin (ablation arm)' }] : []),
    ...(focusCase !== undefined
      ? caseRunOptions(suites ?? [], focusCase, runId)
      : groups
          .filter((g) => !g.error && !g.runIds.includes(runId) && g.id !== runId)
          .map((g) => ({
            value: g.id,
            label: `${stamp(g.startedAt) ?? g.id} · score ${score(g.score)} · ${g.casesTotal ?? 0} cases${g.modelOverride ? ` · ${g.modelOverride}` : ''}`,
          }))),
  ];
  // a preselected run stays selectable even when the lists above do not contain it (yet)
  if (initialBaseline && initialBaseline !== ABLATION_BASELINE && !options.some((o) => o.value === RUN + initialBaseline))
    options.push({ value: RUN + initialBaseline, label: `Run ${stamp(groups.flatMap((g) => g.runs).find((r) => r.id === initialBaseline)?.startedAt) ?? initialBaseline}` });
  const label = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  return (
    <div className={styles.compare}>
      <MultiSelect
        size="xs"
        mb="xs"
        placeholder={choices.length ? undefined : focusCase ? `Compare ${focusCase} with…` : 'Compare with…'}
        aria-label="Compare with"
        data={options.map((o) => ({ value: o.value, label: o.label }))}
        value={choices}
        onChange={setChoices}
        clearable
        searchable
      />
      {choices.map((choice) => (
        <BaselineTable key={choice} choice={choice} title={choices.length > 1 ? label(choice) : undefined} spaceId={spaceId} cases={cases} />
      ))}
    </div>
  );
}

/** Runs of `caseName` over all suites (the compared run excluded), newest first, as select options. */
function caseRunOptions(suites: EvalSuiteEntry[], caseName: string, runId: string) {
  const byId = new Map<string, { startedAt?: string; score?: number; model: string | null; suite: string }>();
  for (const s of suites)
    for (const c of s.cases.filter((x) => x.name === caseName))
      for (const sec of c.sections)
        for (const r of [...sec.runs, ...(sec.baseline ? [sec.baseline] : [])])
          if (r.runId !== runId && !byId.has(r.runId))
            byId.set(r.runId, { startedAt: r.startedAt, score: r.score, model: r.model, suite: s.label });
  return [...byId.entries()]
    .sort(([, a], [, b]) => (Date.parse(b.startedAt ?? '') || 0) - (Date.parse(a.startedAt ?? '') || 0))
    .map(([id, r]) => ({
      value: RUN + id,
      label: `${stamp(r.startedAt) ?? id} · score ${score(r.score)} · ${r.model ?? 'default model'} · ${r.suite}`,
    }));
}

function BaselineTable({
  choice,
  title,
  spaceId,
  cases,
}: {
  choice: string;
  title?: string;
  spaceId: string;
  cases: EvalCase[];
}) {
  const single = choice.startsWith(RUN);
  const baseline = choice === ABLATION ? '' : single ? choice.slice(RUN.length) : choice;
  const base = useEvalRun(spaceId, baseline, !single, baseline !== '');
  const baseCases = base.data?.result.cases;
  const rows = cases.flatMap((c) => {
    const b = choice === ABLATION ? c.arms.without : baseCases?.find((x) => x.name === c.name)?.arms.with;
    return b ? [{ c, a: armStats(c.arms.with), b: armStats(b) }] : [];
  });
  return (
    <>
      {title && <Text size="xs" fw={600}>{title}</Text>}
      {baseline !== '' && base.error && <Text c="red" size="sm">{base.error.message}</Text>}
      {rows.length === 0 && !base.isLoading && (
        <Text size="sm" c="dimmed">No cases in common.</Text>
      )}
      {rows.length > 0 && (
        <Table.ScrollContainer minWidth={600}>
          <Table fz="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Case</Table.Th>
                <Table.Th>Score</Table.Th>
                {METRICS.map((m) => (
                  <Table.Th key={m.label}>{m.label}</Table.Th>
                ))}
                <Table.Th>Changed graders</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map(({ c, a, b }) => {
                const changed = changedGraders(a, b);
                return (
                  <Table.Tr key={c.name}>
                    <Table.Td>{c.name}</Table.Td>
                    <Table.Td>
                      {score(a.score)} vs {score(b.score)} ({a.score !== undefined && b.score !== undefined ? delta(a.score - b.score) : '-'})
                    </Table.Td>
                    {METRICS.map((m) => (
                      <Table.Td key={m.label}>
                        {m.fmt(m.get(a))} vs {m.fmt(m.get(b))} ({diff(m.get(a), m.get(b), (n) => m.fmt(n))})
                      </Table.Td>
                    ))}
                    <Table.Td className={changed.length ? styles.changed : undefined}>
                      {changed.join(', ') || '-'}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </>
  );
}
