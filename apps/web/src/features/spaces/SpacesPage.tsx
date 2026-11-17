import { useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Anchor,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { OpenTraceFile } from '../runs';
import { ColorSchemeToggle } from '../theme';
import { CreateSpaceDialog } from './CreateSpaceDialog';
import { useRemoveSpace, useSpaces } from './hooks';
import { OpenSpaceDialog } from './OpenSpaceDialog';

type DialogState =
  | { kind: 'create'; initial?: { path: string; name: string } }
  | { kind: 'open' }
  | null;

export function SpacesPage() {
  const { data: spaces, error, isPending } = useSpaces();
  const remove = useRemoveSpace();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(
    null,
  );
  const close = () => setDialog(null);

  return (
    <Container component="main" size="sm" py="lg">
      <Stack>
        <Group justify="space-between">
          <Title order={1}>plugin-master</Title>
          <Group>
            <Button onClick={() => setDialog({ kind: 'create' })}>
              New plugin
            </Button>
            <Button
              variant="default"
              onClick={() => setDialog({ kind: 'open' })}
            >
              Open folder
            </Button>
            <OpenTraceFile />
            <ColorSchemeToggle />
          </Group>
        </Group>

        {isPending && <Loader size="sm" />}
        {error && <Alert color="red">{error.message}</Alert>}
        {remove.error && (
          <Alert color="red" withCloseButton onClose={remove.reset}>
            Could not remove: {remove.error.message}
          </Alert>
        )}
        {spaces?.length === 0 && (
          <Text>No plugins yet. Create a new one or open an existing one.</Text>
        )}
        {spaces?.map((s) => (
          <Card key={s.id} withBorder padding="sm">
            <Group justify="space-between" wrap="nowrap">
              <Anchor
                component={Link}
                to={`/spaces/${s.id}`}
                c="inherit"
                underline="never"
                miw={0}
              >
                <Text fw={600}>{s.name}</Text>
                <Text size="sm" c="dimmed" truncate>
                  {s.path}
                </Text>
              </Anchor>
              <Button
                variant="default"
                onClick={() => setRemoving({ id: s.id, name: s.name })}
              >
                Remove from list
              </Button>
            </Group>
          </Card>
        ))}
      </Stack>

      <Modal
        opened={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove from list"
        size="sm"
      >
        <Stack>
          <Text>
            Remove {removing?.name} from the list? The folder is not deleted.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => {
                if (removing) remove.mutate(removing.id);
                setRemoving(null);
              }}
            >
              Remove
            </Button>
          </Group>
        </Stack>
      </Modal>

      {dialog?.kind === 'create' && (
        <CreateSpaceDialog initial={dialog.initial} onClose={close} />
      )}
      {dialog?.kind === 'open' && (
        <OpenSpaceDialog
          onClose={close}
          onInit={(initial) => setDialog({ kind: 'create', initial })}
        />
      )}
    </Container>
  );
}
