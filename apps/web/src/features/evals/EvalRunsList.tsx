import { Text } from '@mantine/core';
import { DataTable } from './DataTable';
import { MetricGrid } from './MetricGrid';
import { invocationColumns, invocationRow } from './columns';
import { useEvalRuns } from './hooks';
import { useOpens } from './prefs';

/** `group` true: `id` is the first run of a multi-run group (merged view). */
type Props = { spaceId: string; onOpen: (id: string, group: boolean) => void };

export const NoResults = ({ dir }: { dir: string }) => (
  <Text c="dimmed">
    No eval results in <code>{dir}/results</code>. Run{' '}
    <code>claude plugin eval</code> in a terminal.
  </Text>
);

export function EvalRunsList({ spaceId, onOpen }: Props) {
  const { data, error } = useEvalRuns(spaceId);
  const { isOpen, toggle } = useOpens();
  if (error) return <Text c="red">{error.message}</Text>;
  if (!data) return null;
  if (!data.groups.length) return <NoResults dir={data.dir} />;
  const rows = data.groups.map(invocationRow);
  const columns = invocationColumns({
    isOpen: (r) => isOpen(`inv:${r.runId}`),
    toggle: (r) => toggle(`inv:${r.runId}`),
  });
  return (
    <>
      <MetricGrid runs={rows} />
      <DataTable
        kind="invocations"
        highlightOnHover
        columns={columns}
        rows={rows}
        rowKey={(r) => r.runId}
        onRowClick={(r) => onOpen(r.runId, r.many)}
        detail={(r) =>
          r.sub &&
          isOpen(`inv:${r.runId}`) && (
            <DataTable
              kind="invocations"
              picker={false}
              columns={columns}
              rows={r.sub}
              rowKey={(x) => x.runId}
              onRowClick={(x) => onOpen(x.runId, false)}
            />
          )
        }
      />
    </>
  );
}
