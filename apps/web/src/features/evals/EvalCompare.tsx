import { useMemo, useState } from 'react';
import { MultiSelect, Table, Text } from '@mantine/core';
import {
  type CaseCompare,
  type EvalCase,
  type EvalSuiteEntry,
} from '@pm/protocol';
import {
  ABLATION_BASELINE,
  baselineKey,
  changedGraders,
  compareToBaseline,
  parseBaseline,
  type Baseline,
} from './compare';
import { caseCompareColumns } from './columns';
import { EvalDataTable } from './EvalDataTable';
import type { Column } from '../../shared/table/types';
import { score, stamp } from '../../shared/format';
import { useEvalRun, useEvalRuns, useEvalSuites } from './hooks';
import styles from './evals.module.scss';

export { ABLATION_BASELINE };

/** Selected baselines at the start: the requested one, else the ablation arm when the run has one. */
function initialChoices(
  initialBaseline: string | undefined,
  hasAblation: boolean,
): string[] {
  const start: Baseline[] =
    initialBaseline === ABLATION_BASELINE || (!initialBaseline && hasAblation)
      ? [{ kind: 'ablation' }]
      : initialBaseline
        ? [{ kind: 'run', runId: initialBaseline }]
        : [];
  return start.map(baselineKey);
}

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
  const [choices, setChoices] = useState<string[]>(() =>
    initialChoices(initialBaseline, hasAblation),
  );
  const groups = useEvalRuns(spaceId).data?.groups ?? [];
  const suites = useEvalSuites(spaceId).data?.suites;
  const options = [
    ...(hasAblation
      ? [
          {
            value: baselineKey({ kind: 'ablation' }),
            label: 'Without the plugin (ablation arm)',
          },
        ]
      : []),
    ...(focusCase !== undefined
      ? caseRunOptions(suites ?? [], focusCase, runId)
      : groups
          .filter(
            (g) => !g.error && !g.runIds.includes(runId) && g.id !== runId,
          )
          .map((g) => ({
            value: baselineKey({ kind: 'group', groupId: g.id }),
            label: `${stamp(g.startedAt) ?? g.id} · score ${score(g.score)} · ${g.casesTotal ?? 0} cases${g.modelOverride ? ` · ${g.modelOverride}` : ''}`,
          }))),
  ];
  // a preselected run stays selectable even when the lists above do not contain it (yet)
  if (
    initialBaseline &&
    initialBaseline !== ABLATION_BASELINE &&
    !options.some(
      (o) => o.value === baselineKey({ kind: 'run', runId: initialBaseline }),
    )
  )
    options.push({
      value: baselineKey({ kind: 'run', runId: initialBaseline }),
      label: `Run ${stamp(groups.flatMap((g) => g.runs).find((r) => r.id === initialBaseline)?.startedAt) ?? initialBaseline}`,
    });
  const label = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  return (
    <div className={styles.compare}>
      <MultiSelect
        size="xs"
        mb="xs"
        placeholder={
          choices.length
            ? undefined
            : focusCase
              ? `Compare ${focusCase} with…`
              : 'Compare with…'
        }
        aria-label="Compare with"
        data={options.map((o) => ({ value: o.value, label: o.label }))}
        value={choices}
        onChange={setChoices}
        clearable
        searchable
      />
      {choices.map((choice) => (
        <BaselineTable
          key={choice}
          choice={choice}
          title={choices.length > 1 ? label(choice) : undefined}
          spaceId={spaceId}
          cases={cases}
        />
      ))}
    </div>
  );
}

/** Runs of `caseName` over all suites (the compared run excluded), newest first, as select options. */
function caseRunOptions(
  suites: EvalSuiteEntry[],
  caseName: string,
  runId: string,
) {
  const byId = new Map<
    string,
    { startedAt?: string; score?: number; model: string | null; suite: string }
  >();
  for (const s of suites)
    for (const c of s.cases.filter((x) => x.name === caseName))
      for (const sec of c.sections)
        for (const r of [...sec.runs, ...(sec.baseline ? [sec.baseline] : [])])
          if (r.runId !== runId && !byId.has(r.runId))
            byId.set(r.runId, {
              startedAt: r.startedAt,
              score: r.score,
              model: r.model,
              suite: s.label,
            });
  return [...byId.entries()]
    .sort(
      ([, a], [, b]) =>
        (Date.parse(b.startedAt ?? '') || 0) -
        (Date.parse(a.startedAt ?? '') || 0),
    )
    .map(([id, r]) => ({
      value: baselineKey({ kind: 'run', runId: id }),
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
  const baseline = parseBaseline(choice);
  const id =
    baseline.kind === 'run'
      ? baseline.runId
      : baseline.kind === 'group'
        ? baseline.groupId
        : '';
  const base = useEvalRun(
    spaceId,
    id,
    baseline.kind === 'group',
    baseline.kind !== 'ablation',
  );
  const baseCases = base.data?.result.cases;
  const rows = useMemo(
    () =>
      compareToBaseline(
        cases,
        baseline.kind === 'ablation' ? 'ablation' : (baseCases ?? []),
      ),
    [cases, baseline.kind, baseCases],
  );
  return (
    <>
      {title && (
        <Text size="xs" fw={600}>
          {title}
        </Text>
      )}
      {baseline.kind !== 'ablation' && base.error && (
        <Text c="red" size="sm">
          {base.error.message}
        </Text>
      )}
      {rows.length === 0 && !base.isLoading && !base.error && (
        <Text size="sm" c="dimmed">
          No cases in common.
        </Text>
      )}
      {rows.length > 0 && (
        <Table.ScrollContainer minWidth={600}>
          <EvalDataTable
            kind="compare"
            columns={columns}
            rows={rows}
            rowKey={(c) => c.name}
            fz="xs"
          />
        </Table.ScrollContainer>
      )}
    </>
  );
}

const changedColumn: Column<CaseCompare> = {
  id: 'changedGraders',
  label: 'Changed graders',
  render: (c) => {
    const changed = changedGraders(c.from ?? {}, c.to ?? {});
    return (
      <span className={changed.length ? styles.changed : undefined}>
        {changed.join(', ') || '-'}
      </span>
    );
  },
};
const columns = caseCompareColumns({ extra: [changedColumn] });
