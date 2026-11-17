import { Badge, Group, Text, Tooltip } from '@mantine/core';
import type {
  EvalBaselineSection,
  EvalCaseEntry,
  EvalCaseRun,
  EvalSuiteEntry,
} from '@pm/protocol';
import { ABLATION_BASELINE } from './EvalCompare';
import { NoResults } from './EvalRunsList';
import { EvalDataTable } from './EvalDataTable';
import { ExportCasesButton } from './ExportCasesButton';
import { MetricGrid } from './MetricGrid';
import { runsColumns, suiteCaseColumns, type OpenCase } from './columns';
import { useEvalSuites, useSetBaseline } from './hooks';
import { useOpens } from './prefs';
import { CollapsibleSection } from './CollapsibleSection';
import { score, scoreColor, stamp } from '../../shared/format';
import styles from './evals.module.scss';
import { QueryError } from '../../shared/ui/QueryError';

export type { OpenCase };

export function EvalSuitesList({
  spaceId,
  onOpen,
}: {
  spaceId: string;
  onOpen: OpenCase;
}) {
  const { data, error } = useEvalSuites(spaceId);
  if (error) return <QueryError error={error} />;
  if (!data) return null;
  if (!data.suites.length) return <NoResults dir={data.dir} />;
  return (
    <>
      {data.suites.map((s) => (
        <Suite key={s.key} spaceId={spaceId} suite={s} onOpen={onOpen} />
      ))}
    </>
  );
}

function Suite({
  spaceId,
  suite,
  onOpen,
}: {
  spaceId: string;
  suite: EvalSuiteEntry;
  onOpen: OpenCase;
}) {
  const openKey = `suite:${suite.key}`;
  return (
    <CollapsibleSection
      openKey={openKey}
      defaultOpen
      anchor={(open) => (open ? '▾' : '▸')}
      anchorProps={{ 'aria-label': 'Toggle suite' }}
      header={
        <>
          <Text fw={600}>{suite.label}</Text>
          {suite.kind !== 'main' && <Badge variant="light">{suite.kind}</Badge>}
          <Text size="xs" c="dimmed">
            {suite.cases.length} cases · {suite.runCount} runs
          </Text>
          <ExportCasesButton
            spaceId={spaceId}
            cases={suite.cases.map((c) => c.name)}
          />
        </>
      }
    >
      <CasesTable
        spaceId={spaceId}
        cases={suite.cases}
        openKey={openKey}
        showHeader={suite.kind === 'main'}
        onOpen={onOpen}
      />
    </CollapsibleSection>
  );
}

/** Cases of a suite (or of a skill/agent) with their runs in an expandable row; `openKey` prefixes the persisted expand state. */
export function CasesTable({
  spaceId,
  cases,
  openKey,
  showHeader,
  onOpen,
}: {
  spaceId: string;
  cases: EvalCaseEntry[];
  openKey: string;
  showHeader: boolean;
  onOpen: OpenCase;
}) {
  const { isOpen: is, toggle } = useOpens();
  const setBaseline = useSetBaseline(spaceId);
  const caseKey = (c: EvalCaseEntry) => `${openKey}:case:${c.name}`;
  const toggleCase = (c: EvalCaseEntry) => toggle(caseKey(c));
  const isOpen = (c: EvalCaseEntry) => is(caseKey(c));
  return (
    <EvalDataTable
      kind="suiteCases"
      highlightOnHover
      columns={suiteCaseColumns({
        isOpen,
        toggle: toggleCase,
        unpin: (c) => setBaseline.mutate({ case: c.name, runId: null }),
      })}
      rows={cases}
      rowKey={(c) => c.name}
      onRowClick={toggleCase}
      detail={(c) =>
        isOpen(c) &&
        c.sections.map((s, i) => (
          <Section
            key={i}
            spaceId={spaceId}
            s={s}
            caseName={c.name}
            showHeader={showHeader}
            onOpen={onOpen}
          />
        ))
      }
    />
  );
}

function Section({
  spaceId,
  s,
  caseName,
  showHeader,
  onOpen,
}: {
  spaceId: string;
  s: EvalBaselineSection;
  caseName: string;
  showHeader: boolean;
  onOpen: OpenCase;
}) {
  const compareWith =
    s.kind === 'ablation' ? ABLATION_BASELINE : s.baseline?.runId;
  return (
    <div className={styles.baselineSection}>
      {showHeader && (
        <Group gap="xs" mb={4}>
          {s.kind === 'ablation' && (
            <Text size="sm" fw={600}>
              Ablation arm (without the plugin)
            </Text>
          )}
          {s.kind === 'none' && (
            <Text size="sm" fw={600} c="dimmed">
              No baseline
            </Text>
          )}
          {s.baseline && (
            <>
              <Text size="sm" fw={600}>
                Baseline {stamp(s.baseline.startedAt) ?? s.baseline.runId}
              </Text>
              <Text size="sm" c={scoreColor(s.baseline.score)}>
                {score(s.baseline.score)}
              </Text>
              <Text size="sm" c="dimmed">
                {s.baseline.model ?? 'default model'}
              </Text>
              {s.baseline.pinned && <Badge variant="light">pinned</Badge>}
              {s.baseline.after && (
                <Tooltip label="No baseline run started before these runs: this is the nearest later one">
                  <Badge color="yellow" variant="light">
                    after
                  </Badge>
                </Tooltip>
              )}
            </>
          )}
        </Group>
      )}
      <MetricGrid runs={s.runs} />
      <RunsTable
        spaceId={spaceId}
        runs={s.runs}
        caseName={caseName}
        compareWith={compareWith}
        onOpen={onOpen}
      />
    </div>
  );
}

/** Runs of one case, one row each; `compareWith` adds a "compare" link per row. */
export function RunsTable({
  spaceId,
  runs,
  caseName,
  compareWith,
  current,
  onOpen,
}: {
  spaceId: string;
  runs: EvalCaseRun[];
  caseName: string;
  compareWith?: string;
  /** highlighted run id */
  current?: string;
  onOpen: OpenCase;
}) {
  const setBaseline = useSetBaseline(spaceId);
  const onPin = (r: EvalCaseRun) =>
    setBaseline.mutate({ case: caseName, runId: r.pinned ? null : r.runId });
  return (
    <EvalDataTable
      kind="runs"
      fz="xs"
      columns={runsColumns({ caseName, compareWith, onOpen, onPin })}
      rows={runs}
      rowKey={(r) => r.runId}
      rowBg={(r) =>
        r.runId === current ? 'var(--mantine-primary-color-light)' : undefined
      }
    />
  );
}
