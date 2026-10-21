import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ActionIcon, Group, Switch, Text } from '@mantine/core';
import type { HookSource } from '@pm/protocol';
import { CellEditor } from './CellEditor';
import { HooksMatrix } from './HooksMatrix';
import { hooksKey, useHooks } from './hooks';

/** Hook matrix of the space (events x sources) with a cell editor. */
export function HooksWidget({ spaceId }: { spaceId: string }) {
  const qc = useQueryClient();
  const { data, error } = useHooks(spaceId);
  const [onlyUsed, setOnlyUsed] = useState(false);
  const [cell, setCell] = useState<{ event: string; source: HookSource } | null>(null);
  if (error) return <Text c="red" p="md">{error.message}</Text>;
  if (!data) return null;
  return (
    <>
      <Group justify="space-between" px="xs">
        <Switch size="xs" label="Only events with hooks" checked={onlyUsed} onChange={(e) => setOnlyUsed(e.currentTarget.checked)} />
        <ActionIcon variant="subtle" size="sm" aria-label="Refresh hooks" onClick={() => qc.invalidateQueries({ queryKey: hooksKey(spaceId) })}>
          ↻
        </ActionIcon>
      </Group>
      <HooksMatrix data={data} onlyUsed={onlyUsed} onCell={(event, source) => setCell({ event, source })} />
      {cell && <CellEditor key={`${cell.event}/${cell.source}`} spaceId={spaceId} data={data} {...cell} onClose={() => setCell(null)} />}
    </>
  );
}
