import { useState, type ReactNode } from 'react';
import { Text } from '@mantine/core';
import styles from './git.module.scss';

export type DiffFile = { path: string; status?: string };

/**
 * Changed files, one row each (with the status when given); clicking one shows `diff(path)` under
 * the list, normally a read-only `DiffView` loaded per file.
 */
export function FileDiffList({
  files,
  diff,
}: {
  files: DiffFile[];
  diff: (path: string) => ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!files.length)
    return (
      <Text size="sm" c="dimmed">
        No changed files.
      </Text>
    );
  return (
    <>
      {files.map((f) => (
        <div
          key={f.path}
          className={`${styles.row} ${f.path === open ? styles.active : ''}`}
          onClick={() => setOpen(f.path)}
        >
          {f.status && (
            <Text span size="xs" ff="monospace" mr="xs">
              {f.status}
            </Text>
          )}
          {f.path}
        </div>
      ))}
      {open && diff(open)}
    </>
  );
}
