import { Table, Text } from '@mantine/core';
import type { ExperimentComparison } from '@pm/protocol';
import { delta, score } from '../evals/format';
import { FlakyMark, SuiteVerdict } from '../evals/SuiteVerdict';

/** Score per case, experiment vs the latest baseline result; the delta is coloured. */
export function Comparison({ data }: { data: ExperimentComparison }) {
  return (
    <>
      {!data.baseline && <Text size="xs" c="dimmed">No baseline: the space had no earlier result of these cases.</Text>}
      {data.suite && <SuiteVerdict suite={data.suite} />}
      <Table withRowBorders={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Case</Table.Th>
            <Table.Th>Baseline</Table.Th>
            <Table.Th>Experiment</Table.Th>
            <Table.Th>Delta</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.cases.map((c) => {
            const d = c.score !== undefined && c.baselineScore !== undefined ? c.score - c.baselineScore : undefined;
            return (
              <Table.Tr key={c.case}>
                <Table.Td>{c.case} {c.flaky && <FlakyMark />}</Table.Td>
                <Table.Td>{score(c.baselineScore)}</Table.Td>
                <Table.Td>{score(c.score)}</Table.Td>
                <Table.Td c={d === undefined || d === 0 ? 'dimmed' : d > 0 ? 'green' : 'red'}>{delta(d)}</Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </>
  );
}
