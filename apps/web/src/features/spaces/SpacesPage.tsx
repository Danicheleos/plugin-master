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
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { ColorSchemeToggle } from '../theme/ColorSchemeToggle';
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
            <ColorSchemeToggle />
          </Group>
        </Group>

        {isPending && <Loader size="sm" />}
        {error && <Alert color="red">{error.message}</Alert>}
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
              <Button variant="default" onClick={() => remove.mutate(s.id)}>
                Remove from list
              </Button>
            </Group>
          </Card>
        ))}
      </Stack>

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
