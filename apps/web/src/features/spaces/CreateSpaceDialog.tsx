import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { FolderPicker } from '../folder/FolderPicker';
import { useCreateSpace } from './hooks';

type Props = { initial?: { path: string; name: string }; onClose: () => void };

const join = (parent: string, name: string) =>
  parent.replace(/[\\/]+$/, '') + (parent.includes('\\') ? '\\' : '/') + name;

export function CreateSpaceDialog({ initial, onClose }: Props) {
  // `initial` = initialize an existing folder in place (no parent + name join).
  const [parent, setParent] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState('');
  const [picking, setPicking] = useState(false);
  const create = useCreateSpace();
  const navigate = useNavigate();
  const path = initial ? initial.path : parent && join(parent, name);

  return (
    <Modal opened onClose={onClose} title="New plugin">
      {picking ? (
        <FolderPicker
          onSelect={(p) => {
            setParent(p);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!path) return;
            create.mutate(
              { path, name, description },
              { onSuccess: (space) => navigate(`/spaces/${space.id}`) },
            );
          }}
        >
          <Stack>
            {initial ? (
              <Text size="sm">{initial.path}</Text>
            ) : (
              <Group gap="xs" wrap="nowrap">
                <Button variant="default" onClick={() => setPicking(true)}>
                  {parent ? 'Change parent folder' : 'Choose parent folder'}
                </Button>
                <Text size="sm" truncate>
                  {parent ?? 'No folder selected'}
                </Text>
              </Group>
            )}
            <TextInput
              label="Name (kebab-case)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              required
              data-autofocus
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
              <Button type="submit" loading={create.isPending} disabled={!path}>
                Create
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}
