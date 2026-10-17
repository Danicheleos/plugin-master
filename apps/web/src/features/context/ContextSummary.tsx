import { useState } from 'react';
import { Alert, Button, Group, Text } from '@mantine/core';
import { useSpaceConfig, useToggleContext } from './hooks';
import styles from './context.module.scss';

const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((p, i) => p === b[i]);

type Props = {
  spaceId: string;
  /** masterContext the active session started with; null = no session. */
  contextFiles: string[] | null;
  /** Entries of the session's context that did not exist at its start. */
  missingContext: string[];
  onNewSession: () => void;
};

export function ContextSummary({
  spaceId,
  contextFiles,
  missingContext,
  onNewSession,
}: Props) {
  const { data, error } = useSpaceConfig(spaceId);
  const toggle = useToggleContext(spaceId);
  const [open, setOpen] = useState(false);
  if (error)
    return (
      <Alert color="yellow" radius={0}>
        Failed to read .plugin-master/config.json: {error.message}
      </Alert>
    );
  if (!data) return null;
  const files = data.masterContext;
  const changed = contextFiles !== null && !same(files, contextFiles);
  return (
    <div className={styles.summary}>
      <Button variant="subtle" size="compact-sm" onClick={() => setOpen(!open)}>
        Context: {files.length} {files.length === 1 ? 'file' : 'files'}
      </Button>
      {open && (
        <ul>
          {files.length === 0 && <li>No pinned files</li>}
          {files.map((p) => (
            <li key={p}>
              {p}
              {missingContext.includes(p) && (
                <>
                  {' '}
                  <Text span c="orange" inherit>
                    (file not found)
                  </Text>{' '}
                  <Button
                    variant="default"
                    size="compact-xs"
                    onClick={() => toggle(p)}
                  >
                    Unpin
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {changed && (
        <Alert color="yellow" mt="xs">
          <Group gap="xs">
            Context changed — start a new session
            <Button variant="default" size="compact-xs" onClick={onNewSession}>
              New session
            </Button>
          </Group>
        </Alert>
      )}
    </div>
  );
}
