import { useState } from 'react';
import { Button, Stack, Text } from '@mantine/core';
import { BranchBar } from './BranchBar';
import { CommitForm } from './CommitForm';
import { DiffPane } from './DiffPane';
import { StatusList } from './StatusList';
import { useGitAction, useGitStatus } from './hooks';

/** Git of the space: branch bar, changed files with a diff, commit form and log. */
export function GitWidget({ spaceId }: { spaceId: string }) {
  const { data, error } = useGitStatus(spaceId);
  const init = useGitAction(spaceId, 'init');
  const [open, setOpen] = useState<string | null>(null);
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  if (error) return <Text c="red" p="md">{error.message}</Text>;
  if (!data) return null;
  if (!data.isRepo)
    return (
      <Stack p="md" align="flex-start" gap="xs">
        <Text size="sm">This space is not a git repository yet.</Text>
        <Button size="xs" loading={init.isPending} onClick={() => init.mutate(undefined)}>
          Initialize repository
        </Button>
        {init.error && <Text c="red" size="sm">{init.error.message}</Text>}
      </Stack>
    );
  // a renamed entry commits both sides, else the old path stays staged as a deletion
  const selected = data.files.flatMap((f) =>
    unchecked.has(f.path) ? [] : f.from ? [f.path, f.from] : [f.path],
  );
  return (
    <Stack gap="xs" h="100%" style={{ overflow: 'auto' }}>
      <BranchBar spaceId={spaceId} dirty={data.files.length > 0} />
      <StatusList
        files={data.files}
        open={open}
        unchecked={unchecked}
        onOpen={setOpen}
        onToggle={(p) =>
          setUnchecked((u) => {
            const n = new Set(u);
            if (!n.delete(p)) n.add(p);
            return n;
          })
        }
      />
      {open && <DiffPane spaceId={spaceId} path={open} />}
      <CommitForm spaceId={spaceId} paths={selected} />
    </Stack>
  );
}
