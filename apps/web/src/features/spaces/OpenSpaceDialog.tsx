import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, Group, Modal, Stack, TextInput } from '@mantine/core';
import { ApiError } from '../../api/http';
import { useOpenSpace } from './hooks';

type Props = {
  onClose: () => void;
  onInit: (init: { path: string; name: string }) => void;
};

export function OpenSpaceDialog({ onClose, onInit }: Props) {
  const [path, setPath] = useState('');
  const open = useOpenSpace();
  const navigate = useNavigate();
  const notAPlugin =
    open.error instanceof ApiError && open.error.code === 'NOT_A_PLUGIN';
  const basename = path.replace(/\/+$/, '').split('/').pop() ?? '';

  return (
    <Modal opened onClose={onClose} title="Open folder">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          open.mutate(
            { path },
            { onSuccess: (space) => navigate(`/spaces/${space.id}`) },
          );
        }}
      >
        <Stack>
          <TextInput
            label="Plugin path (absolute)"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
            data-autofocus
          />
          {open.error && <Alert color="red">{open.error.message}</Alert>}
          <Group justify="flex-end">
            {notAPlugin && (
              <Button
                variant="default"
                onClick={() => onInit({ path, name: basename })}
              >
                Initialize here
              </Button>
            )}
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={open.isPending}>
              Open
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
