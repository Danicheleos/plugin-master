import { Text } from '@mantine/core';
import { DiffEditor } from '@monaco-editor/react';
import type { GitDiff } from '@pm/protocol';
import { useMonacoTheme } from '../ui/useMonacoTheme';
import styles from './diff.module.scss';

/** A read-only diff of already loaded old/new texts. */
export function DiffView({
  data,
  label = ['head', 'work'],
}: {
  data: GitDiff;
  label?: [string, string];
}) {
  const path = data.path;
  const theme = useMonacoTheme();
  if (data.binary || data.tooLarge)
    return (
      <Text size="sm" c="dimmed" p="xs">
        {data.binary ? 'Binary file: no diff.' : 'File too large: no diff.'}
      </Text>
    );
  return (
    <div className={styles.diff}>
      <DiffEditor
        original={data.old}
        modified={data.new}
        originalModelPath={`${label[0]}/${path}`}
        modifiedModelPath={`${label[1]}/${path}`}
        theme={theme}
        options={{
          readOnly: true,
          renderSideBySide: false,
          minimap: { enabled: false },
        }}
      />
    </div>
  );
}
