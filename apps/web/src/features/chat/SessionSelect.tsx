import { useState } from 'react';
import { Button, CloseButton, Group, Modal, Select, Text } from '@mantine/core';
import { useChatActions, useChatSettings, useChatStatus } from './ChatContext';
import { useDeleteSession, useSessions } from './hooks';

type Target = { id: string; title: string };

/** Confirms deleting a past session: its transcript and recorded run go for good. */
export function DeleteSessionModal({
  target,
  error,
  pending,
  onCancel,
  onConfirm,
}: {
  target: Target | null;
  error?: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (id: string) => void;
}) {
  return (
    <Modal
      opened={!!target}
      onClose={onCancel}
      title="Delete session?"
      size="sm"
    >
      <Text size="sm">
        “{target?.title}”: its transcript and recorded run are deleted for good.
      </Text>
      {error && (
        <Text size="sm" c="red" mt="xs">
          {error}
        </Text>
      )}
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          color="red"
          loading={pending}
          onClick={() => target && onConfirm(target.id)}
        >
          Delete
        </Button>
      </Group>
    </Modal>
  );
}

/** Switches between past sessions; every option except the open one has a delete button (with confirmation). */
export function SessionSelect({ spaceId }: { spaceId: string }) {
  const { sessionId } = useChatSettings();
  const status = useChatStatus();
  const { resume } = useChatActions();
  const sessions = useSessions(spaceId, sessionId, status);
  const removeSession = useDeleteSession(spaceId);
  const [deleting, setDeleting] = useState<Target | null>(null);
  return (
    <>
      <Select
        size="xs"
        flex={1}
        miw={140}
        aria-label="Session"
        placeholder="New session"
        allowDeselect={false}
        data={(sessions.data ?? []).map((s) => ({
          value: s.id,
          label: s.title,
        }))}
        value={sessionId}
        onChange={(id) => id && id !== sessionId && resume(id)}
        renderOption={({ option }) => (
          <Group gap={4} wrap="nowrap" w="100%" justify="space-between">
            <Text size="sm" truncate>
              {option.label}
            </Text>
            {option.value !== sessionId && (
              <CloseButton
                size="xs"
                aria-label={`Delete session ${option.label}`}
                // the option must not be picked (resumed) by this click
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  removeSession.reset();
                  setDeleting({ id: option.value, title: option.label });
                }}
              />
            )}
          </Group>
        )}
      />
      <DeleteSessionModal
        target={deleting}
        error={removeSession.error?.message}
        pending={removeSession.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={(id) =>
          removeSession.mutate(id, { onSuccess: () => setDeleting(null) })
        }
      />
    </>
  );
}
