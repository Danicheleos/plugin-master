import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, Group, Modal, Stack, TextInput } from '@mantine/core';
import { useCreateSpace } from './hooks';

type Props = { initial?: { path: string; name: string }; onClose: () => void };

export function CreateSpaceDialog({ initial, onClose }: Props) {
  const [path, setPath] = useState(initial?.path ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState('');
  const create = useCreateSpace();
  const navigate = useNavigate();

  return (
    <Modal opened onClose={onClose} title="New plugin">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { path, name, description },
            { onSuccess: (space) => navigate(`/spaces/${space.id}`) },
          );
        }}
      >
        <Stack>
          <TextInput
            label="Path (absolute)"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
            data-autofocus
          />
          <TextInput
            label="Name (kebab-case)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            required
          />
          <TextInput
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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
