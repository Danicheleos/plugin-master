import { useState } from 'react';
import { Alert, Button, Group, Modal, Stack, TextInput } from '@mantine/core';
import { useCreateFile } from './hooks';

type Props = {
  spaceId: string;
  onCreated: (path: string) => void;
  onClose: () => void;
};

export function NewFileDialog({ spaceId, onCreated, onClose }: Props) {
  const [path, setPath] = useState('');
  const create = useCreateFile(spaceId);
  return (
    <Modal opened onClose={onClose} title="New file">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { path, content: '' },
            { onSuccess: () => onCreated(path) },
          );
        }}
      >
        <Stack>
          <TextInput
            label="Path (folders allowed)"
            value={path}
            placeholder="skills/foo/SKILL.md"
            onChange={(e) => setPath(e.target.value)}
            required
            data-autofocus
          />
          {create.error && <Alert color="red">{create.error.message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
