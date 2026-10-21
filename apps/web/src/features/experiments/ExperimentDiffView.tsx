import { useState } from 'react';
import { Text } from '@mantine/core';
import { DiffView } from '../git/DiffPane';
import styles from '../git/git.module.scss';
import { useExperimentDiff } from './hooks';

/** Changed files of the branch against its base, with a read-only diff of the selected one. */
export function ExperimentDiffView({ spaceId, n }: { spaceId: string; n: number }) {
  const { data, error } = useExperimentDiff(spaceId, n);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <Text c="red" size="sm">{error.message}</Text>;
  if (!data) return null;
  if (!data.files.length) return <Text size="sm" c="dimmed">No changed files.</Text>;
  const sel = data.files.find((f) => f.path === open);
  return (
    <>
      {data.files.map((f) => (
        <div key={f.path} className={`${styles.row} ${f.path === open ? styles.active : ''}`} onClick={() => setOpen(f.path)}>
          {f.path}
        </div>
      ))}
      {data.truncated && <Text size="xs" c="dimmed">Only the first files are listed.</Text>}
      {sel && <DiffView data={sel} label={['base', 'exp']} />}
    </>
  );
}
