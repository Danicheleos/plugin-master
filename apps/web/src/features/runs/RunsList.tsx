import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ActionIcon, Badge, Group, Table, Text, Tooltip } from '@mantine/core';
import { useOnChatIdle } from '../chat/ChatContext';
import { TraceDialog } from '../evals/TraceView';
import { cost, stamp } from '../evals/format';
import { runsKey, useRunTrace, useRuns } from './hooks';

function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function RunTraceModal({ spaceId, runId, title, onClose }: { spaceId: string; runId: string; title: string; onClose: () => void }) {
  const { data, error } = useRunTrace(spaceId, runId);
  return <TraceDialog title={`Run: ${title}`} trace={data} error={error} onClose={onClose} />;
}

export function RunsList({ spaceId }: { spaceId: string }) {
  const { data, error } = useRuns(spaceId);
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);
  if (error) return <Text c="red">{error.message}</Text>;
  if (!data) return null;
  if (!data.runs.length) return <Text c="dimmed" p="md">No runs yet</Text>;
  return (
    <>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Run</Table.Th>
            <Table.Th>Started</Table.Th>
            <Table.Th>Turns</Table.Th>
            <Table.Th>Cost</Table.Th>
            <Table.Th>Models</Table.Th>
            <Table.Th>Commit</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.runs.map((r) =>
            'error' in r ? (
              <Table.Tr key={r.id}>
                <Table.Td>{r.id}</Table.Td>
                <Table.Td colSpan={5}>
                  <Tooltip label={r.error}>
                    <Badge color="red">error</Badge>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ) : (
              <Table.Tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpen({ id: r.id, title: r.title })}>
                <Table.Td>{r.title}</Table.Td>
                <Table.Td>
                  <Tooltip label={stamp(r.startedAt)}>
                    <Text size="sm">{ago(r.startedAt)}</Text>
                  </Tooltip>
                </Table.Td>
                <Table.Td>{r.turns}</Table.Td>
                <Table.Td>{cost(r.costUsd)}</Table.Td>
                <Table.Td>{r.models.join(', ')}</Table.Td>
                <Table.Td>{r.commit?.slice(0, 7)}</Table.Td>
              </Table.Tr>
            ),
          )}
        </Table.Tbody>
      </Table>
      {open && <RunTraceModal spaceId={spaceId} runId={open.id} title={open.title} onClose={() => setOpen(null)} />}
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
        <ActionIcon variant="subtle" size="sm" aria-label="Refresh runs" onClick={refresh}>
          ↻
        </ActionIcon>
      </Group>
      <RunsList spaceId={spaceId} />
    </>
  );
}
