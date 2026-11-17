import { useState } from 'react';
import { Anchor, Group, Text } from '@mantine/core';
import type { GitCommit } from '@pm/protocol';
import { ago, shortHash } from '../../shared/format';

/** Collapsed list of recent commits. */
export function Log({ commits }: { commits: GitCommit[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Anchor
        size="xs"
        component="button"
        type="button"
        onClick={() => setOpen(!open)}
      >
        {`${open ? 'Hide' : 'Show'} log (${commits.length})`}
      </Anchor>
      {open &&
        commits.map((c) => (
          <Group key={c.hash} gap="xs" wrap="nowrap">
            <Text size="xs" ff="monospace">
              {shortHash(c.hash)}
            </Text>
            <Text size="xs" truncate flex={1}>
              {c.message}
            </Text>
            <Text size="xs" c="dimmed">
              {ago(c.date)}
            </Text>
          </Group>
        ))}
    </>
  );
}
