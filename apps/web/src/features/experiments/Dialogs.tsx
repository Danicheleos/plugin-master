import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { ApiAlert } from './ApiAlert';
import { useExperimentAction } from './hooks';

type Props = { spaceId: string; n: number; onClose: () => void };

function Confirm({ spaceId, n, onClose, action, title, text, label, color }: Props & {
  action: 'merge' | 'discard';
  title: string;
  text: string;
  label: string;
  color?: string;
}) {
  const m = useExperimentAction(spaceId, n, action);
  return (
    <Modal opened onClose={onClose} title={title}>
      <Stack gap="xs">
        <Text size="sm">{text}</Text>
        {m.error && <ApiAlert error={m.error} />}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Close</Button>
          <Button color={color} loading={m.isPending} onClick={() => m.mutate(undefined, { onSuccess: onClose })}>{label}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** The current branch is only named by the server in errors; the text says "the current branch". */
export const MergeDialog = (p: Props) => (
  <Confirm {...p} action="merge" title={`Merge exp/${p.n}`} label="Merge"
    text={`Merges exp/${p.n} into the current branch and appends the proposal to STATE.md/DECISIONS.md.`} />
);

export const DiscardDialog = (p: Props) => (
  <Confirm {...p} action="discard" color="red" title={`Discard exp/${p.n}`} label="Discard"
    text={`Removes the worktree and the branch exp/${p.n}. This cannot be undone.`} />
);
