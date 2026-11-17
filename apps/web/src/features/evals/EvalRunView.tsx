import { useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Code,
  Collapse,
  Group,
  Modal,
  ScrollArea,
  SegmentedControl,
  Switch,
  Text,
  Typography,
} from '@mantine/core';
import type {
  EvalCase,
  EvalCaseRun,
  EvalGraderResult,
  EvalRunResult,
} from '@pm/protocol';
import { EvalDataTable } from './EvalDataTable';
import { EvalCompare } from './EvalCompare';
import { MetricGrid } from './MetricGrid';
import { RunsTable } from './EvalSuitesList';
import { MetricsLine, TraceBody } from '../../shared/trace/TraceView';
import { TraceModal } from './TraceModal';
import { ExportCasesButton } from './ExportCasesButton';
import { runCaseColumns } from './columns';
import {
  latestPerCase,
  repeatedCaseNames,
  splitRepetitions,
  type RepCase,
} from './compare';
import {
  useEvalReport,
  useEvalRun,
  useEvalSuites,
  useEvalTrace,
  type TraceTarget,
} from './hooks';
import { useEvalPrefs, useOpen, useOpens } from './prefs';
import { cost, duration, score, scoreColor, stamp } from '../../shared/format';
import styles from './evals.module.scss';
import { QueryError } from '../../shared/ui/QueryError';

type Props = {
  spaceId: string;
  /** a run id, or with `group` the first run of a group (merged view) */
  runId: string;
  group?: boolean;
  onBack: () => void;
  /** opens a path in the editor; offered only when the cases live in the space (`spaceRoot`) */
  onOpenFile?: (path: string) => void;
  spaceRoot?: string;
  /** show only this case, opened */
  focusCase?: string;
  /** preselect a baseline in the comparison (see `EvalCompare`) */
  compareWith?: string;
  /** switch to another run of the focused case without leaving the page */
  onSwitch?: (runId: string) => void;
};

export function EvalRunView({
  spaceId,
  runId,
  group,
  onBack,
  onOpenFile,
  spaceRoot,
  focusCase,
  compareWith,
  onSwitch,
}: Props) {
  const { data, error } = useEvalRun(spaceId, runId, group);
  const [report, setReport] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceTarget | null>(null);
  return (
    <div>
      <Group mb="sm">
        <Anchor component="button" onClick={onBack}>
          ← Back
        </Anchor>
        {!group && !runId.endsWith('.json') && (
          <Button
            size="compact-sm"
            variant="default"
            onClick={() => setReport(runId)}
          >
            Open HTML report
          </Button>
        )}
        <ExportCasesButton
          spaceId={spaceId}
          size="compact-sm"
          label="Export case history"
          cases={
            focusCase
              ? [focusCase]
              : (data?.result.cases.map((c) => c.name) ?? [])
          }
        />
      </Group>
      {error && <QueryError error={error} />}
      {data && (
        <RunBody
          key={`${group ? 'g:' : ''}${runId}`}
          spaceId={spaceId}
          runId={runId}
          data={data}
          focusCase={focusCase}
          compareWith={compareWith}
          onSwitch={onSwitch}
          onReport={setReport}
          onTrace={setTrace}
          onOpenFile={
            data.result.suite.root === '.' ||
            data.result.suite.root === spaceRoot
              ? onOpenFile
              : undefined
          }
        />
      )}
      {trace && (
        <TraceModal
          spaceId={spaceId}
          target={trace}
          onClose={() => setTrace(null)}
        />
      )}
      {report && (
        <ReportModal
          spaceId={spaceId}
          runId={report}
          onClose={() => setReport(null)}
        />
      )}
    </div>
  );
}

type RunData = NonNullable<ReturnType<typeof useEvalRun>['data']>;

/** The run page body: summary line, comparison (or run switcher) and the case table. */
function RunBody({
  spaceId,
  runId,
  data,
  focusCase,
  compareWith,
  onSwitch,
  onReport,
  onTrace,
  onOpenFile,
}: {
  spaceId: string;
  runId: string;
  data: RunData;
  focusCase?: string;
  compareWith?: string;
  onSwitch?: (runId: string) => void;
  onReport: (runId: string) => void;
  onTrace: (t: TraceTarget) => void;
  onOpenFile?: (path: string) => void;
}) {
  const { result } = data;
  const cases = useMemo(
    () =>
      focusCase
        ? result.cases.filter((c) => c.name === focusCase)
        : result.cases,
    [result.cases, focusCase],
  );
  return (
    <>
      {data.unknownSchema && (
        <Alert color="yellow" mb="sm">
          Unknown schemaVersion ({result.schemaVersion}): some fields may be
          missing.
        </Alert>
      )}
      {result.partial && (
        <Alert color="yellow" mb="sm">
          Partial run: {result.partialReason ?? 'stopped early'}
        </Alert>
      )}
      <RunSummary result={result} invocations={data.group?.runIds.length} />
      <RunComparison
        spaceId={spaceId}
        runId={runId}
        cases={cases}
        focusCase={focusCase}
        compareWith={compareWith}
        onSwitch={onSwitch}
      />
      <RunCaseTable
        spaceId={spaceId}
        runId={runId}
        result={result}
        cases={cases}
        group={data.group}
        onReport={onReport}
        onTrace={onTrace}
        onOpenFile={onOpenFile}
      />
    </>
  );
}

function RunSummary({
  result,
  invocations,
}: {
  result: RunData['result'];
  /** merged group view: number of CLI invocations */
  invocations?: number;
}) {
  const { aggregates: a, suite } = result;
  return (
    <Group mb="md" gap="lg">
      <Text c={scoreColor(a.overallScore, suite.threshold ?? 1)} fw={600}>
        Score {score(a.overallScore)}
      </Text>
      <Text>
        Passed {a.casesPassed ?? 0}/{a.casesTotal ?? result.cases.length}
      </Text>
      <Text>Cost {cost(result.costUsd)}</Text>
      <Text>Time {duration(result.durationSeconds)}</Text>
      <Text c="dimmed">Claude {result.claudeVersion ?? '-'}</Text>
      {suite.modelOverride && <Text c="dimmed">{suite.modelOverride}</Text>}
      {invocations !== undefined && (
        <Text c="dimmed">{invocations} invocations</Text>
      )}
    </Group>
  );
}

/** A focused case switches between its runs; otherwise the run is compared with a baseline. */
function RunComparison({
  spaceId,
  runId,
  cases,
  focusCase,
  compareWith,
  onSwitch,
}: {
  spaceId: string;
  runId: string;
  cases: EvalCase[];
  focusCase?: string;
  compareWith?: string;
  onSwitch?: (runId: string) => void;
}) {
  // the comparison takes one result per case: the latest invocation
  const latest = useMemo(() => latestPerCase(cases), [cases]);
  if (focusCase !== undefined)
    return (
      onSwitch && (
        <RunSwitcher
          spaceId={spaceId}
          runId={runId}
          caseName={focusCase}
          onSwitch={onSwitch}
        />
      )
    );
  return (
    <EvalCompare
      key={compareWith}
      spaceId={spaceId}
      runId={runId}
      cases={latest}
      initialBaseline={compareWith}
    />
  );
}

function RunCaseTable({
  spaceId,
  runId,
  result,
  cases,
  group,
  onReport,
  onTrace,
  onOpenFile,
}: {
  spaceId: string;
  runId: string;
  result: RunData['result'];
  cases: EvalCase[];
  /** merged group view: start time and report per invocation */
  group?: RunData['group'];
  onReport: (runId: string) => void;
  onTrace: (t: TraceTarget) => void;
  onOpenFile?: (path: string) => void;
}) {
  const threshold = result.suite.threshold ?? 1;
  const { isOpen, toggle } = useOpens();
  const [{ split }, update] = useEvalPrefs();
  const repeated = useMemo(() => repeatedCaseNames(cases), [cases]);
  const stamps = useMemo(
    () =>
      Object.fromEntries(
        (group?.runs ?? []).map((r) => [r.id, stamp(r.startedAt)]),
      ),
    [group],
  );
  const reports = useMemo(
    () => new Set(group?.runs.filter((r) => r.hasReport).map((r) => r.id)),
    [group],
  );
  const manyReps = cases.some((c) => c.arms.with.length > 1);
  const rows: RepCase[] = useMemo(
    () => (split ? splitRepetitions(cases) : cases),
    [split, cases],
  );
  const caseKey = (c: RepCase) =>
    `run:${runId}:case:${c.name}${c.runId ? `:${c.runId}` : ''}${c.rep ? `:rep${c.rep}` : ''}`;
  return (
    <>
      {manyReps && (
        <Switch
          size="xs"
          mb="xs"
          label="One row per repetition"
          checked={split}
          onChange={(e) => update(() => ({ split: e.currentTarget.checked }))}
        />
      )}
      <EvalDataTable
        kind="runCases"
        columns={runCaseColumns({
          threshold,
          isOpen: (c) => isOpen(caseKey(c), false),
          toggle: (c) => toggle(caseKey(c), false),
          suffix: (c) =>
            repeated.has(c.name)
              ? (c.runId && stamps[c.runId]) || c.runId
              : undefined,
          onOpenFile,
          onReport: (c) =>
            c.runId && reports.has(c.runId)
              ? () => onReport(c.runId as string)
              : undefined,
        })}
        rows={rows}
        rowKey={(c) => `${c.runId ?? ''}\0${c.name}\0${c.rep ?? ''}`}
        detail={(c) =>
          isOpen(caseKey(c), false) &&
          (['with', 'without'] as const).map((arm) => (
            <Arm
              key={arm}
              spaceId={spaceId}
              title={arm}
              runs={c.arms[arm]}
              offset={(c.rep ?? 1) - 1}
              c={c}
              runId={c.runId ?? runId}
              openKey={caseKey(c)}
              onTrace={onTrace}
            />
          ))
        }
      />
    </>
  );
}

/** Scrollable table of every run of one case (from the suites index), newest first; the current one is highlighted. */
function RunSwitcher({
  spaceId,
  runId,
  caseName,
  onSwitch,
}: {
  spaceId: string;
  runId: string;
  caseName: string;
  onSwitch: (runId: string) => void;
}) {
  const { data } = useEvalSuites(spaceId);
  const runs = new Map<string, EvalCaseRun>();
  for (const suite of data?.suites ?? [])
    for (const c of suite.cases)
      if (c.name === caseName)
        for (const sec of c.sections)
          for (const r of sec.runs) runs.set(r.runId, r);
  const sorted = [...runs.values()].sort((a, b) =>
    (b.startedAt ?? '').localeCompare(a.startedAt ?? ''),
  );
  if (sorted.length < 2) return null;
  return (
    <>
      <MetricGrid runs={sorted} />
      <ScrollArea.Autosize mah={260} mb="md">
        <RunsTable
          spaceId={spaceId}
          runs={sorted}
          caseName={caseName}
          current={runId}
          onOpen={onSwitch}
        />
      </ScrollArea.Autosize>
    </>
  );
}

function Arm({
  spaceId,
  title,
  runs,
  offset,
  c,
  runId,
  openKey,
  onTrace,
}: {
  spaceId: string;
  title: 'with' | 'without';
  runs: EvalRunResult[];
  /** index of the first run among the case's repetitions (split rows) */
  offset: number;
  c: EvalCase;
  runId: string;
  openKey: string;
  onTrace: (t: TraceTarget) => void;
}) {
  if (!runs.length) return null;
  return (
    <div>
      <Text fw={600} size="sm">
        Arm: {title}
      </Text>
      {runs.map((r, j) => {
        const i = j + offset;
        return (
          <div
            key={`${runId}:${c.name}:${title}:${i}`}
            className={styles.graders}
          >
            <Group gap="md">
              <Text size="sm">Run {i + 1}</Text>
              <Text size="sm" c={scoreColor(r.score)}>
                {score(r.score)}
              </Text>
              <Badge color={r.passed ? 'green' : 'red'}>
                {r.passed ? 'passed' : 'failed'}
              </Badge>
              <Text size="xs" c="dimmed">
                {r.turns ?? '-'} turns ·{' '}
                {cost((r.costUsd ?? 0) + (r.judgeCostUsd ?? 0))} incl. judge ·{' '}
                {duration(r.durationSeconds)}
              </Text>
              {!r.traceMetrics && (
                <Text size="xs" c="dimmed">
                  no trace
                </Text>
              )}
              {r.traceMetrics && (
                <Anchor
                  component="button"
                  size="xs"
                  onClick={() =>
                    onTrace({ runId, case: c.name, arm: title, n: i + 1 })
                  }
                >
                  flow / trace
                </Anchor>
              )}
              {r.skippedPaidGraders && (
                <Badge color="gray">skipped paid graders</Badge>
              )}
            </Group>
            {r.traceMetrics && <MetricsLine m={r.traceMetrics} />}
            {r.error && (
              <Text c="red" size="sm">
                {r.error}
              </Text>
            )}
            <RunDetails
              key={runId}
              spaceId={spaceId}
              c={c}
              r={r}
              openKey={`${openKey}:${title}:${i}`}
              target={{ runId, case: c.name, arm: title, n: i + 1 }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Flow (default, when the run has a trace) or the judges' results of one run. */
function RunDetails({
  spaceId,
  c,
  r,
  openKey,
  target,
}: {
  spaceId: string;
  c: EvalCase;
  r: EvalRunResult;
  openKey: string;
  target: TraceTarget;
}) {
  const hasTrace = !!r.traceMetrics;
  const [view, setView] = useState(hasTrace ? 'flow' : 'judges');
  const graders = r.graders.map((g) => (
    <Grader
      key={g.name}
      openKey={`${openKey}:grader:${g.name}`}
      g={g}
      def={c.graders.find((d) => d.name === g.name)}
    />
  ));
  if (!hasTrace) return <>{graders}</>;
  return (
    <>
      <SegmentedControl
        size="xs"
        my="xs"
        value={view}
        onChange={setView}
        data={[
          { value: 'flow', label: 'Flow' },
          { value: 'judges', label: 'Judges' },
        ]}
      />
      {view === 'flow' ? (
        <InlineFlow spaceId={spaceId} target={target} />
      ) : (
        graders
      )}
    </>
  );
}

function InlineFlow({
  spaceId,
  target,
}: {
  spaceId: string;
  target: TraceTarget;
}) {
  const { data, error } = useEvalTrace(spaceId, target);
  if (error) return <QueryError error={error} />;
  return data ? (
    <TraceBody trace={data} />
  ) : (
    <Text size="sm" c="dimmed">
      Loading…
    </Text>
  );
}

function Grader({
  g,
  def,
  openKey,
}: {
  openKey: string;
  g: EvalGraderResult;
  def?: EvalCase['graders'][number];
}) {
  const [open, toggle] = useOpen(openKey);
  const greyed = g.scored === false || g.withOnly;
  const extra = g.evidence ?? def?.graderMarkdown;
  return (
    <div className={greyed ? styles.muted : undefined}>
      <Group gap="xs">
        <Badge color={g.passed ? 'green' : 'red'} variant="light">
          {g.passed ? 'pass' : 'fail'}
        </Badge>
        <Text size="sm">{g.name}</Text>
        <Text size="xs" c="dimmed">
          {def?.type ?? ''} · weight {g.weight ?? '-'}
          {g.scored === false && ' · not scored'}
          {g.withOnly && ' · with-arm only'}
          {g.judgeVotes && ` · votes ${g.judgeVotes.map(String).join('/')}`}
        </Text>
        {extra && (
          <Anchor component="button" size="xs" onClick={toggle}>
            {open ? 'hide' : 'details'}
          </Anchor>
        )}
      </Group>
      {g.explanation && (
        <Text size="sm" ml="md">
          {g.explanation}
        </Text>
      )}
      <Collapse expanded={open}>
        {g.evidence && (
          <Typography ml="md">
            <Markdown>{g.evidence}</Markdown>
          </Typography>
        )}
        {def?.graderMarkdown && (
          <Code block fz="xs" ml="md">
            {def.graderMarkdown}
          </Code>
        )}
      </Collapse>
    </div>
  );
}

function ReportModal({
  spaceId,
  runId,
  onClose,
}: {
  spaceId: string;
  runId: string;
  onClose: () => void;
}) {
  const { data, error } = useEvalReport(spaceId, runId);
  return (
    <Modal opened onClose={onClose} title="Eval report" size="90%">
      {error && <QueryError error={error} />}
      {data !== undefined && (
        // scripts may run but the document has no origin (no allow-same-origin)
        <iframe
          className={styles.frame}
          title="Eval report"
          sandbox="allow-scripts"
          // the response's CSP header does not apply to srcdoc: no network from the report (Chromium)
          {...{
            csp: "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:",
          }}
          srcDoc={data}
        />
      )}
    </Modal>
  );
}
