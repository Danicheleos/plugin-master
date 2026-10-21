import { useState } from 'react';
import { Alert, Button, Stack, Textarea } from '@mantine/core';
import { useGitAction, useGitLog } from './hooks';
import { Log } from './Log';

/** Message + "Commit selected (N)"; the log of recent commits sits below. */
export function CommitForm({ spaceId, paths }: { spaceId: string; paths: string[] }) {
  const [message, setMessage] = useState('');
  const commit = useGitAction<{ message: string; paths: string[] }>(spaceId, 'commit');
  const log = useGitLog(spaceId);
  return (
    <Stack gap="xs" px="xs" pb="xs">
      <Textarea
        size="xs"
        placeholder="Commit message"
        autosize
        minRows={2}
        value={message}
        onChange={(e) => setMessage(e.currentTarget.value)}
      />
      <Button
        size="xs"
        disabled={!message.trim() || !paths.length}
        loading={commit.isPending}
        onClick={() => commit.mutate({ message, paths }, { onSuccess: () => setMessage('') })}
      >
        {`Commit selected (${paths.length})`}
      </Button>
      {commit.error && <Alert color="red" p="xs">{commit.error.message}</Alert>}
      <Log commits={log.data ?? []} />
    </Stack>
  );
}
