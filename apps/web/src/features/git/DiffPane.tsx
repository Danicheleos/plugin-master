import { Text, useComputedColorScheme } from '@mantine/core';
import { DiffEditor } from '@monaco-editor/react';
import type { GitDiff } from '@pm/protocol';
import { useGitDiff } from './hooks';
import styles from './git.module.scss';

/** HEAD vs working tree of one file (read-only). */
export function DiffPane({ spaceId, path }: { spaceId: string; path: string }) {
  const { data, error } = useGitDiff(spaceId, path);
  if (error) return <Text c="red" size="sm" p="xs">{error.message}</Text>;
  return data ? <DiffView data={data} /> : null;
}

/** A read-only diff of already loaded old/new texts. */
export function DiffView({ data, label = ['head', 'work'] }: { data: GitDiff; label?: [string, string] }) {
  const path = data.path;
  const scheme = useComputedColorScheme('light');
  if (data.binary || data.tooLarge)
    return <Text size="sm" c="dimmed" p="xs">{data.binary ? 'Binary file: no diff.' : 'File too large: no diff.'}</Text>;
  return (
    <div className={styles.diff}>
      <DiffEditor
        original={data.old}
        modified={data.new}
        originalModelPath={`${label[0]}/${path}`}
        modifiedModelPath={`${label[1]}/${path}`}
        theme={scheme === 'dark' ? 'vs-dark' : 'vs'}
        options={{ readOnly: true, renderSideBySide: false, minimap: { enabled: false } }}
      />
    </div>
  );
}
