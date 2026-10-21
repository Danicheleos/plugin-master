import { useState } from 'react';
import { Alert, Button, Group, Modal, Select, Text, TextInput } from '@mantine/core';
import { useGitAction, useGitBranches } from './hooks';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

type Switch = { name: string; carry?: boolean };

/** Branch select (switching a dirty tree asks first) and a "New branch" form. */
export function BranchBar({ spaceId, dirty }: { spaceId: string; dirty: boolean }) {
  const { data } = useGitBranches(spaceId);
  const sw = useGitAction<Switch>(spaceId, 'switch');
  const create = useGitAction<{ name: string }>(spaceId, 'branch');
  const [pending, setPending] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const bad = name !== '' && !NAME_RE.test(name);
  const error = [sw.error, create.error].find(Boolean);
  const pick = (v: string | null) => {
    if (!v || v === data?.current) return;
    if (dirty) setPending(v);
    else sw.mutate({ name: v });
  };
  return (
    <>
      <Group gap="xs" px="xs" wrap="nowrap">
        <Select
          size="xs"
          aria-label="Branch"
          data={data?.local ?? []}
          value={data?.current ?? null}
          placeholder="detached"
          allowDeselect={false}
          onChange={pick}
        />
        <Button size="xs" variant="default" onClick={() => setAdding(!adding)}>New branch</Button>
      </Group>
      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name && !bad)
              create.mutate({ name }, { onSuccess: () => { setName(''); setAdding(false); } });
          }}
        >
          <Group gap="xs" px="xs" wrap="nowrap">
            <TextInput
              size="xs"
              placeholder="branch-name"
              value={name}
              error={bad ? 'Letters, digits, . _ / - only; not starting with a symbol' : undefined}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <Button size="xs" type="submit" disabled={!name || bad} loading={create.isPending}>Create</Button>
          </Group>
        </form>
      )}
      {error && <Alert color="red" p="xs" mx="xs">{error.message}</Alert>}
      <Modal opened={pending !== null} onClose={() => setPending(null)} title="Uncommitted changes">
        <Text size="sm" mb="md">
          The working tree has changes (GIT_DIRTY). Switching carries them over to
          <b>{` ${pending} `}</b>
          if git can, otherwise the switch fails; nothing is discarded.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setPending(null)}>Cancel</Button>
          <Button
            onClick={() => {
              sw.mutate({ name: pending ?? '', carry: true });
              setPending(null);
            }}
          >
            Switch anyway (keep my changes)
          </Button>
        </Group>
      </Modal>
    </>
  );
}
