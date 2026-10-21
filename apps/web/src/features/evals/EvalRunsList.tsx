import { Text } from '@mantine/core';
import { DataTable } from './DataTable';
import { MetricGrid } from './MetricGrid';
import { invocationColumns, invocationRow, type Invocation } from './columns';
import type { MetricRun } from './metrics';
import { useEvalRuns } from './hooks';
import { useOpens } from './prefs';

/** `group` true: `id` is the first run of a multi-run group (merged view). */
type Props = { spaceId: string; onOpen: (id: string, group: boolean) => void };

export const NoResults = ({ dir }: { dir: string }) => (
  <Text c="dimmed">
    No eval results in <code>{dir}/results</code>. Run <code>claude plugin eval</code> in a
    terminal.
  </Text>
);

const asMetrics = (r: Invocation): MetricRun => ({
  runId: r.id,
  startedAt: r.startedAt,
  score: r.score,
  passRate: r.passRate,
  costUsd: r.cost,
  durationMs: r.durationSeconds === undefined ? undefined : r.durationSeconds * 1000,
});

export function EvalRunsList({ spaceId, onOpen }: Props) {
  const { data, error } = useEvalRuns(spaceId);
  const { isOpen, toggle } = useOpens();
  if (error) return <Text c="red">{error.message}</Text>;
  if (!data) return null;
  if (!data.groups.length) return <NoResults dir={data.dir} />;
  const rows = data.groups.map(invocationRow);
  const columns = invocationColumns({ isOpen: (r) => isOpen(`inv:${r.id}`), toggle: (r) => toggle(`inv:${r.id}`) });
  return (
    <>
      <MetricGrid runs={rows.map(asMetrics)} />
      <DataTable
        kind="invocations"
        highlightOnHover
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => onOpen(r.id, r.many)}
        detail={(r) =>
          r.sub &&
          isOpen(`inv:${r.id}`) && (
            <DataTable
              kind="invocations"
              picker={false}
              columns={columns}
              rows={r.sub}
              rowKey={(x) => x.id}
              onRowClick={(x) => onOpen(x.id, false)}
            />
          )
        }
      />
    </>
  );
}
