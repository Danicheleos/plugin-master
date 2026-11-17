import { useState } from 'react';
import { Badge, Divider, ScrollArea, Table, Text } from '@mantine/core';
import { cost } from '../../shared/format';
import { Ledger } from './Ledger';
import { ExperimentDetail } from './ExperimentDetail';
import { StartForm } from './StartForm';
import { useExperiment, useExperiments } from './hooks';
import { QueryError } from '../../shared/ui/QueryError';
import { experimentStatusColor } from '../../shared/ui/status';

/** Master-loop experiments: start form, list (newest first) and the selected experiment. */
export function ExperimentsWidget({ spaceId }: { spaceId: string }) {
  const { data, error } = useExperiments(spaceId);
  const [n, setN] = useState<number | null>(null);
  const detail = useExperiment(spaceId, n);
  return (
    <ScrollArea h="100%">
      <StartForm spaceId={spaceId} />
      <Divider />
      {error && <QueryError error={error} p="xs" />}
      {data && !data.length && (
        <Text c="dimmed" p="xs">
          No experiments yet
        </Text>
      )}
      {data && data.length > 0 && (
        <Table highlightOnHover>
          <Table.Tbody>
            {[...data]
              .sort((a, b) => b.id - a.id)
              .map((e) => (
                <Table.Tr
                  key={e.id}
                  style={{ cursor: 'pointer' }}
                  bg={
                    e.id === n
                      ? 'var(--mantine-primary-color-light)'
                      : undefined
                  }
                  onClick={() => setN(e.id)}
                >
                  <Table.Td>{e.id}</Table.Td>
                  <Table.Td>
                    {e.plan?.title ??
                      (e.kind === 'description'
                        ? `Description: ${e.skill}`
                        : 'experiment')}
                  </Table.Td>
                  <Table.Td>
                    <Badge size="sm" color={experimentStatusColor(e.status)}>
                      {e.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{e.stage ?? ''}</Table.Td>
                  <Table.Td>{cost(e.costUsd)}</Table.Td>
                </Table.Tr>
              ))}
          </Table.Tbody>
        </Table>
      )}
      <Ledger spaceId={spaceId} />
      {detail.error && <QueryError error={detail.error} p="xs" />}
      {detail.data && <ExperimentDetail spaceId={spaceId} exp={detail.data} />}
    </ScrollArea>
  );
}
