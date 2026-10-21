import { Checkbox, Text } from '@mantine/core';
import type { GitFile } from '@pm/protocol';
import styles from './git.module.scss';

type Props = {
  files: GitFile[];
  open: string | null;
  unchecked: ReadonlySet<string>;
  onOpen: (path: string) => void;
  onToggle: (path: string) => void;
};

/** Changed files with a checkbox (commit selection) each; a click opens the diff. */
export function StatusList({ files, open, unchecked, onOpen, onToggle }: Props) {
  if (!files.length) return <Text size="sm" c="dimmed" px="xs">Working tree clean</Text>;
  return (
    <div>
      {files.map((f) => (
        <div
          key={f.path}
          className={`${styles.row} ${f.path === open ? styles.active : ''}`}
          onClick={() => onOpen(f.path)}
        >
          <Checkbox
            size="xs"
            aria-label={`Commit ${f.path}`}
            checked={!unchecked.has(f.path)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggle(f.path)}
          />
          <span className={styles.code}>{`${f.index}${f.workingDir}`.replace(/ /g, '·')}</span>
          <Text size="sm" truncate>{f.from ? `${f.from} → ${f.path}` : f.path}</Text>
        </div>
      ))}
    </div>
  );
}
