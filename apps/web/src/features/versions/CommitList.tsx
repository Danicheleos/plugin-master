import { Text, Tooltip } from '@mantine/core';
import type { VersionEntry } from '@pm/protocol';
import { cost, delta } from '../evals/format';
import styles from './versions.module.scss';

const warning = (c: VersionEntry) =>
  [c.eval?.dirty && 'run on a dirty tree', c.eval?.approx && 'run mapped by time (approximate)', c.eval?.partial && 'partial run', c.eval?.skippedPaid && 'paid cases skipped']
    .filter(Boolean)
    .join(', ');

export function CommitList({ commits, picked, onPick }: { commits: VersionEntry[]; picked: string[]; onPick: (hash: string) => void }) {
  return (
    <>
      {commits.map((c) => {
        const warn = warning(c);
        return (
          <button
            key={c.hash}
            type="button"
            aria-pressed={picked.includes(c.hash)}
            className={`${styles.row} ${picked.includes(c.hash) ? styles.selected : ''}`}
            onClick={() => onPick(c.hash)}
          >
            <Text size="xs" ff="monospace" c="dimmed">{c.hash.slice(0, 7)}</Text>
            <Text size="sm" className={styles.subject}>{c.message}</Text>
            {c.delta !== undefined && (
              <Text size="xs" c={c.delta < 0 ? 'red' : c.delta > 0 ? 'green' : 'dimmed'}>{delta(c.delta)}</Text>
            )}
            <Text size="xs" c="dimmed">{cost(c.eval?.costUsd)}</Text>
            {warn && (
              <Tooltip label={warn}>
                <span role="img" aria-label={`warning: ${warn}`}>⚠</span>
              </Tooltip>
            )}
          </button>
        );
      })}
    </>
  );
}
