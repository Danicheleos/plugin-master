import { Text } from '@mantine/core';
import type { ExperimentComparison } from '@pm/protocol';
import { caseCompareColumns } from '../evals/columns';
import { DataTable } from '../evals/DataTable';
import { SuiteVerdict } from '../evals/SuiteVerdict';

// no trace buttons: worktree runs are not readable through the space trace route
const columns = caseCompareColumns({});

/** The shared case comparison table: experiment vs the latest baseline result of the space. */
export function Comparison({ data }: { data: ExperimentComparison }) {
  return (
    <>
      {!data.baseline && (
        <Text size="xs" c="dimmed">
          No baseline: the space had no earlier result of these cases.
        </Text>
      )}
      {data.suite && <SuiteVerdict suite={data.suite} />}
      <DataTable
        kind="compare"
        columns={columns}
        rows={data.cases}
        rowKey={(c) => c.name}
      />
    </>
  );
}
