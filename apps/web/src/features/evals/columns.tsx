import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { Anchor, Badge, Group, Text, Tooltip } from '@mantine/core';
import type {
  EvalCaseEntry,
  EvalCaseRun,
  EvalGroup,
  EvalRunSummary,
} from '@pm/protocol';
import type { Column } from './DataTable';
import { armStats, type RepCase } from './compare';
import { METRICS, type Metrics } from './metrics';
import {
  cost,
  delta,
  duration,
  num,
  score,
  scoreColor,
  stamp,
  tokens,
} from './format';
import { MetricChart } from './MetricChart';
import styles from './evals.module.scss';

/** Column registries per table kind; metric columns come from `METRICS` (same labels and formatters as the charts). */
export type OpenCase = (
  runId: string,
  caseName: string,
  compareWith?: string,
) => void;

export const deltaColor = (d?: number) =>
  d === undefined || d === 0 ? undefined : d > 0 ? 'green' : 'red';
const colored = (text: string, c?: string) => (
  <Text span inherit c={c}>
    {text}
  </Text>
);
export const Toggle = ({
  open,
  onClick,
  children,
  ...rest
}: { open: boolean; onClick: () => void; children: ReactNode } & ComponentProps<
  typeof Anchor
>) => (
  <Anchor
    component="button"
    aria-expanded={open}
    {...rest}
    onClick={(e: MouseEvent) => {
      e.stopPropagation();
      onClick();
    }}
  >
    {open ? '▾' : '▸'} {children}
  </Anchor>
);

/** Metric columns of rows holding `Metrics`; `get` picks them off the row. */
function metricColumns<R>(
  get: (r: R) => Metrics,
  skip: string[] = [],
  off = false,
): Column<R>[] {
  return METRICS.filter((m) => !skip.includes(m.id)).map((m) => ({
    id: m.id,
    label: m.short,
    title: m.label,
    render: (r: R) =>
      m.id === 'score'
        ? colored(m.format(m.get(get(r))), scoreColor(m.get(get(r))))
        : m.format(m.get(get(r))),
    sortValue: (r: R) => m.get(get(r)),
    has: (r: R) => m.get(get(r)) !== undefined,
    off,
  }));
}
const pick = <R,>(cols: Column<R>[], id: string) =>
  cols.find((c) => c.id === id) as Column<R>;

/** Runs of one case (skill/agent expansion, run page neighbours, suites case expansion). */
export function runsColumns(ctx: {
  caseName: string;
  compareWith?: string;
  onOpen: OpenCase;
  /** adds the "Set as baseline" / "Unset baseline" toggle per run */
  onPin?: (r: EvalCaseRun) => void;
}): Column<EvalCaseRun>[] {
  const m = metricColumns<EvalCaseRun>((r) => r);
  const by = (id: string) => pick(m, id);
  return [
    {
      id: 'run',
      label: 'Run',
      fixed: true,
      render: (r) => (
        <Group gap="xs" wrap="nowrap">
          <Anchor
            component="button"
            size="xs"
            onClick={() => ctx.onOpen(r.runId, ctx.caseName)}
          >
            {stamp(r.startedAt) ?? r.runId}
          </Anchor>
          {r.pinned && (
            <Badge size="xs" variant="light">
              baseline
            </Badge>
          )}
          {r.refs?.map((l) => (
            <Badge key={l} size="xs" variant="outline">
              {l}
            </Badge>
          ))}
        </Group>
      ),
    },
    by('score'),
    {
      id: 'delta',
      label: 'Δ',
      render: (r) => colored(delta(r.delta), deltaColor(r.delta)),
      sortValue: (r) => r.delta,
    },
    ...[
      'costUsd',
      'turns',
      'maxContext',
      'tokens',
      'durationMs',
      'passRate',
      'recall',
      'precision',
      'f1',
    ].map(by),
    {
      id: 'model',
      label: 'Model',
      render: (r) => r.model ?? '-',
      sortValue: (r) => r.model ?? undefined,
    },
    {
      id: 'compare',
      label: '',
      title: 'Compare link',
      has: () => !!ctx.compareWith,
      render: (r) =>
        ctx.compareWith && (
          <Anchor
            component="button"
            size="xs"
            onClick={() => ctx.onOpen(r.runId, ctx.caseName, ctx.compareWith)}
          >
            compare
          </Anchor>
        ),
    },
    {
      id: 'pin',
      label: '',
      title: 'Pin as baseline',
      has: () => !!ctx.onPin,
      render: (r) =>
        ctx.onPin && (
          <Anchor
            component="button"
            size="xs"
            aria-label={`${r.pinned ? 'Unset' : 'Set as'} baseline ${r.runId}`}
            onClick={() => ctx.onPin?.(r)}
          >
            {r.pinned ? 'Unset baseline' : 'Set as baseline'}
          </Anchor>
        ),
    },
  ];
}

/** Cases of a suite: the latest result plus the metrics of the latest run. */
export function suiteCaseColumns(ctx: {
  isOpen: (c: EvalCaseEntry) => boolean;
  toggle: (c: EvalCaseEntry) => void;
  /** unpins a pin whose run is gone */
  unpin?: (c: EvalCaseEntry) => void;
}): Column<EvalCaseEntry>[] {
  const m = metricColumns<EvalCaseEntry>((c) => c.latest, ['score'], true);
  return [
    {
      id: 'case',
      label: 'Case',
      fixed: true,
      render: (c) => (
        <Toggle open={ctx.isOpen(c)} onClick={() => ctx.toggle(c)}>
          {c.name}
        </Toggle>
      ),
      sortValue: (c) => c.name,
    },
    {
      id: 'latest',
      label: 'Latest',
      render: (c) => colored(score(c.latest.score), scoreColor(c.latest.score)),
      sortValue: (c) => c.latest.score,
    },
    {
      id: 'baseline',
      label: 'Baseline',
      render: (c) => (
        <Group gap={4} wrap="nowrap">
          {score(c.latest.baselineScore)}
          {c.sections[0]?.baseline?.pinned && (
            <Badge size="xs" variant="light">
              pinned
            </Badge>
          )}
          {c.stalePin && (
            <Tooltip label={`Pinned run ${c.stalePin} no longer exists; the auto baseline is used`}>
              <Badge size="xs" color="yellow" variant="light">
                stale pin
                {ctx.unpin && (
                  <Anchor
                    component="button"
                    size="xs"
                    ml={4}
                    aria-label={`Unset stale baseline of ${c.name}`}
                    onClick={(e: MouseEvent) => {
                      e.stopPropagation();
                      ctx.unpin?.(c);
                    }}
                  >
                    unset
                  </Anchor>
                )}
              </Badge>
            </Tooltip>
          )}
        </Group>
      ),
      sortValue: (c) => c.latest.baselineScore,
    },
    {
      id: 'delta',
      label: 'Δ',
      render: (c) => colored(delta(c.latest.delta), deltaColor(c.latest.delta)),
      sortValue: (c) => c.latest.delta,
    },
    {
      id: 'runs',
      label: 'Runs',
      render: (c) => c.runCount,
      sortValue: (c) => c.runCount,
    },
    {
      id: 'lastRun',
      label: 'Last run',
      render: (c) => stamp(c.lastRunAt) ?? '-',
      sortValue: (c) => c.lastRunAt,
    },
    {
      id: 'trend',
      label: 'Trend',
      render: (c) =>
        c.trend.length > 1 && (
          <MetricChart
            points={c.trend.map((value, i) => ({ key: String(i), value }))}
            max={1}
            className={styles.trend}
            label={`Last ${c.trend.length} scores of ${c.name}`}
            format={score}
          />
        ),
    },
    ...m,
  ];
}

/** Cases within one run page. */
export function runCaseColumns(ctx: {
  threshold: number;
  isOpen: (c: RepCase) => boolean;
  toggle: (c: RepCase) => void;
  /** distinguishes invocations of the same case in a group */
  suffix: (c: RepCase) => string | undefined;
  onOpenFile?: (path: string) => void;
  onReport: (c: RepCase) => (() => void) | undefined;
}): Column<RepCase>[] {
  const stats = (c: RepCase) => armStats(c.arms.with);
  return [
    {
      id: 'case',
      label: 'Case',
      fixed: true,
      render: (c) => {
        const report = ctx.onReport(c);
        return (
          <Group gap="xs" wrap="nowrap">
            <Toggle open={ctx.isOpen(c)} onClick={() => ctx.toggle(c)}>
              {c.name}
            </Toggle>
            {ctx.suffix(c) && (
              <Text size="xs" c="dimmed">
                {ctx.suffix(c)}
              </Text>
            )}
            {c.rep && (
              <Text size="xs" c="dimmed">
                run {c.rep}/{c.of}
              </Text>
            )}
            {ctx.onOpenFile && c.dir && (
              <Anchor
                component="button"
                size="xs"
                onClick={() => ctx.onOpenFile?.(`${c.dir}/prompt.md`)}
              >
                open
              </Anchor>
            )}
            {report && (
              <Anchor component="button" size="xs" onClick={report}>
                report
              </Anchor>
            )}
          </Group>
        );
      },
    },
    {
      id: 'score',
      label: 'Score',
      render: (c) =>
        colored(
          score(c.aggregates.score),
          scoreColor(c.aggregates.score, ctx.threshold),
        ),
      sortValue: (c) => c.aggregates.score,
    },
    {
      id: 'delta',
      label: 'Δ',
      render: (c) => delta(c.aggregates.delta),
      sortValue: (c) => c.aggregates.delta,
    },
    {
      id: 'turns',
      label: 'Turns',
      render: (c) => num(stats(c).turns),
      sortValue: (c) => stats(c).turns,
    },
    {
      id: 'calls',
      label: 'Calls (model/tool)',
      render: (c) => `${num(stats(c).modelCalls)}/${num(stats(c).toolCalls)}`,
    },
    {
      id: 'maxContext',
      label: 'Max context',
      render: (c) => tokens(stats(c).maxContext),
      sortValue: (c) => stats(c).maxContext,
    },
    {
      id: 'cost',
      label: 'Cost',
      render: (c) => cost(stats(c).cost),
      sortValue: (c) => stats(c).cost,
    },
    {
      id: 'result',
      label: 'Result',
      render: (c) => {
        const s = c.aggregates.score;
        return s === undefined ? (
          '-'
        ) : (
          <Badge color={s >= ctx.threshold ? 'green' : 'red'}>
            {s >= ctx.threshold ? 'pass' : 'fail'}
          </Badge>
        );
      },
    },
  ];
}

/** An invocation group or one of its runs, flattened to the fields the invocations table shows. */
export type Invocation = {
  id: string;
  startedAt?: string;
  /** more than one run */
  many: boolean;
  runs: number;
  cases?: number;
  passed?: number;
  score?: number;
  passRate?: number;
  threshold: number;
  cost?: number;
  durationSeconds?: number;
  model?: string | null;
  claude?: string;
  plugin?: string;
  badges: { label: string; color?: string; variant?: string; tip?: string }[];
  /** the label of the first column */
  title?: string;
  /** a run listed under its group */
  nested?: boolean;
  sub?: Invocation[];
};

const mean = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
};

function range(g: EvalGroup) {
  const from = stamp(g.startedAt);
  const to = stamp(g.endedAt);
  if (!from) return g.id;
  if (g.runIds.length < 2 || !to || to === from) return from;
  return to.slice(0, 10) === from.slice(0, 10)
    ? `${from} – ${to.slice(11)}`
    : `${from} – ${to}`;
}

const summaryRow = (r: EvalRunSummary): Invocation => ({
  id: r.id,
  startedAt: r.startedAt,
  many: false,
  runs: 1,
  cases: r.casesTotal,
  passed: r.casesPassed,
  score: r.overallScore,
  passRate: r.overallPassRate,
  threshold: r.threshold ?? 1,
  cost: r.costUsd,
  durationSeconds: r.durationSeconds,
  model: r.modelOverride,
  claude: r.claudeVersion,
  plugin: r.pluginVersion,
  badges: [],
  title: `${stamp(r.startedAt)} · ${r.id}`,
  nested: true,
});

export function invocationRow(g: EvalGroup): Invocation {
  const many = g.runIds.length > 1;
  return {
    id: g.id,
    startedAt: g.startedAt,
    many,
    runs: g.totalRuns,
    cases: g.casesTotal,
    passed: g.casesPassed,
    score: g.score,
    passRate:
      g.runs.length === 1
        ? g.runs[0]?.overallPassRate
        : mean(g.runs.map((r) => r.overallPassRate)),
    threshold: g.threshold ?? 1,
    cost: g.costUsd,
    durationSeconds: g.durationSeconds,
    model: g.modelOverride,
    claude: g.claudeVersion,
    plugin: g.pluginVersion,
    title: range(g),
    badges: [
      ...(many
        ? [{ label: `${g.runIds.length} invocations`, variant: 'outline' }]
        : []),
      ...(g.error ? [{ label: 'unreadable', color: 'red', tip: g.error }] : []),
      ...(g.partial ? [{ label: 'partial', color: 'yellow' }] : []),
      ...(g.skippedPaid
        ? [
            {
              label: 'skipped graders',
              color: 'gray',
              tip: 'Paid graders were skipped: not comparable with full runs',
            },
          ]
        : []),
      ...(g.ablation === 'with-without'
        ? [{ label: 'A/B', variant: 'light' }]
        : []),
    ],
    sub: many ? g.runs.map(summaryRow) : undefined,
  };
}

/** Invocation groups (and, nested, their runs). */
export function invocationColumns(ctx: {
  isOpen: (r: Invocation) => boolean;
  toggle: (r: Invocation) => void;
}): Column<Invocation>[] {
  return [
    {
      id: 'run',
      label: 'Run',
      fixed: true,
      render: (r) => (
        <Group gap="xs">
          {r.sub && (
            <Anchor
              component="button"
              aria-expanded={ctx.isOpen(r)}
              aria-label="Invocations"
              onClick={(e) => {
                e.stopPropagation();
                ctx.toggle(r);
              }}
            >
              {ctx.isOpen(r) ? '▾' : '▸'}
            </Anchor>
          )}
          <Text
            size={r.nested ? 'xs' : 'sm'}
            c={r.nested ? 'dimmed' : undefined}
            ml={r.nested ? 'md' : undefined}
          >
            {r.title}
          </Text>
          {r.badges.map((b) => {
            const badge = (
              <Badge key={b.label} color={b.color} variant={b.variant}>
                {b.label}
              </Badge>
            );
            return b.tip ? (
              <Tooltip key={b.label} label={b.tip}>
                {badge}
              </Tooltip>
            ) : (
              badge
            );
          })}
        </Group>
      ),
    },
    {
      id: 'cases',
      label: 'Cases',
      render: (r) => r.cases ?? '-',
      sortValue: (r) => r.cases,
    },
    {
      id: 'runs',
      label: 'Runs',
      render: (r) => r.runs,
      sortValue: (r) => r.runs,
    },
    {
      id: 'score',
      label: 'Score',
      render: (r) => colored(score(r.score), scoreColor(r.score, r.threshold)),
      sortValue: (r) => r.score,
    },
    {
      id: 'passed',
      label: 'Passed',
      render: (r) =>
        r.cases === undefined ? '-' : `${r.passed ?? 0}/${r.cases}`,
    },
    {
      id: 'passRate',
      label: 'Pass rate',
      has: (r) => r.passRate !== undefined,
      render: (r) => score(r.passRate),
      sortValue: (r) => r.passRate,
    },
    {
      id: 'cost',
      label: 'Cost',
      render: (r) => cost(r.cost),
      sortValue: (r) => r.cost,
    },
    {
      id: 'time',
      label: 'Time',
      render: (r) => duration(r.durationSeconds),
      sortValue: (r) => r.durationSeconds,
    },
    {
      id: 'model',
      label: 'Model',
      render: (r) => r.model ?? '-',
      sortValue: (r) => r.model ?? undefined,
    },
    { id: 'claude', label: 'Claude', render: (r) => r.claude ?? '-' },
    {
      id: 'plugin',
      label: 'Plugin',
      has: (r) => r.plugin !== undefined,
      render: (r) => r.plugin ?? '-',
    },
  ];
}
