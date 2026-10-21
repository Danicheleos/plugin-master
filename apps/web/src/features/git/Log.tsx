import { useState } from 'react';
import { Anchor, Group, Text } from '@mantine/core';
import type { GitCommit } from '@pm/protocol';

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 60) return `${m} min ago`;
  return m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** Collapsed list of recent commits. */
export function Log({ commits }: { commits: GitCommit[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Anchor size="xs" component="button" type="button" onClick={() => setOpen(!open)}>
        {`${open ? 'Hide' : 'Show'} log (${commits.length})`}
      </Anchor>
      {open &&
        commits.map((c) => (
          <Group key={c.hash} gap="xs" wrap="nowrap">
            <Text size="xs" ff="monospace">{c.hash.slice(0, 7)}</Text>
            <Text size="xs" truncate flex={1}>{c.message}</Text>
            <Text size="xs" c="dimmed">{ago(c.date)}</Text>
          </Group>
        ))}
    </>
  );
}
