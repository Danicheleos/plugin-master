import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ActionIcon, Badge, Group, Table, Text, Tooltip } from '@mantine/core';
import { LiveRunTraceModal, useOnChatIdle } from '../chat';
import {
  ago,
  cost,
  elapsedMs,
  seconds,
  shortHash,
  stamp,
} from '../../shared/format';
import { runsKey, useRuns } from './hooks';
import { QueryError } from '../../shared/ui/QueryError';

export function RunsList({ spaceId }: { spaceId: string }) {
  const { data, error } = useRuns(spaceId);
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);
  if (error) return <QueryError error={error} />;
  if (!data) return null;
  if (!data.runs.length)
    return (
      <Text c="dimmed" p="md">
        No runs yet
      </Text>
    );
  return (
    <>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Run</Table.Th>
            <Table.Th>Started</Table.Th>
            <Table.Th>Duration</Table.Th>
            <Table.Th>Turns</Table.Th>
            <Table.Th>Cost</Table.Th>
            <Table.Th>Models</Table.Th>
            <Table.Th>Claude</Table.Th>
            <Table.Th>Commit</Table.Th>
            <Table.Th>Resumed from</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.runs.map((r) =>
            'error' in r ? (
              <Table.Tr key={r.id}>
                <Table.Td>{r.id}</Table.Td>
                <Table.Td colSpan={8}>
                  <Tooltip label={r.error}>
                    <Badge color="red">error</Badge>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ) : (
              <Table.Tr
                key={r.id}
                style={{ cursor: 'pointer' }}
                onClick={() => setOpen({ id: r.id, title: r.title })}
              >
                <Table.Td>{r.title}</Table.Td>
                <Table.Td>
                  <Tooltip label={stamp(r.startedAt)}>
                    <Text size="sm">{ago(r.startedAt)}</Text>
                  </Tooltip>
                </Table.Td>
                <Table.Td>
                  <Tooltip label={`ended ${stamp(r.endedAt)}`}>
                    <Text size="sm">
                      {seconds(elapsedMs(r.startedAt, r.endedAt) || undefined)}
                    </Text>
                  </Tooltip>
                </Table.Td>
                <Table.Td>{r.turns}</Table.Td>
                <Table.Td>{cost(r.costUsd)}</Table.Td>
                <Table.Td>{r.models.join(', ')}</Table.Td>
                <Table.Td>{r.claudeVersion}</Table.Td>
                <Table.Td>{shortHash(r.commit)}</Table.Td>
                <Table.Td>
                  <Tooltip label={r.resumedFrom} disabled={!r.resumedFrom}>
                    <Text size="sm">{r.resumedFrom?.slice(0, 8)}</Text>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ),
          )}
        </Table.Tbody>
      </Table>
      {open && (
        <LiveRunTraceModal
          spaceId={spaceId}
          runId={open.id}
          title={open.title}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/** The widget: the list plus a refresh button; refetches whenever the chat turns idle (a run was just recorded). */
export function RunsWidget({ spaceId }: { spaceId: string }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: runsKey(spaceId) });
  useOnChatIdle(refresh);
  return (
    <>
      <Group justify="flex-end" px="xs">
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label="Refresh runs"
          onClick={refresh}
        >
          ↻
        </ActionIcon>
      </Group>
      <RunsList spaceId={spaceId} />
    </>
  );
}
