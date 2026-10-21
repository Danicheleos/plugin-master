import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { ApiError } from '../../api/http';
import { FolderPicker } from '../folder/FolderPicker';
import { useOpenSpace } from './hooks';

type Props = {
  onClose: () => void;
  onInit: (init: { path: string; name: string }) => void;
};

export function OpenSpaceDialog({ onClose, onInit }: Props) {
  const [path, setPath] = useState<string | null>(null);
  const open = useOpenSpace();
  const navigate = useNavigate();
  const notAPlugin =
    open.error instanceof ApiError && open.error.code === 'NOT_A_PLUGIN';
  const basename =
    path
      ?.replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? '';

  return (
    <Modal opened onClose={onClose} title="Open plugin folder">
      {path === null ? (
        <FolderPicker onSelect={setPath} onCancel={onClose} />
      ) : (
        <Stack>
          <Text size="sm">{path}</Text>
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
            <Button
              variant="default"
              onClick={() => {
                open.reset();
                setPath(null);
              }}
            >
              Change folder
            </Button>
            <Button
              loading={open.isPending}
              onClick={() =>
                open.mutate(
                  { path },
                  { onSuccess: (space) => navigate(`/spaces/${space.id}`) },
                )
              }
            >
              Open
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
