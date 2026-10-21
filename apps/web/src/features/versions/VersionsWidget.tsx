import { useState } from 'react';
import { Stack, Text } from '@mantine/core';
import type { VersionEntry } from '@pm/protocol';
import { Compare } from './Compare';
import { MetricChart } from '../evals/MetricChart';
import { score } from '../evals/format';
import { CommitList } from './CommitList';
import { useVersions } from './hooks';
import styles from './versions.module.scss';

/** Eval score per commit: trend, commit list and a compare pane (files, cases, gate) of two commits. */
export function VersionsWidget({ spaceId }: { spaceId: string }) {
  const { data, error } = useVersions(spaceId);
  // up to two picked hashes; null = the default (last two commits)
  const [picked, setPicked] = useState<string[] | null>(null);
  if (error) return <Text c="red" p="md">{error.message}</Text>;
  if (!data) return null;
  const commits = data.commits;
  if (!commits.length) return <Text c="dimmed" p="md">No commits yet.</Text>;
  if (!commits.some((c) => c.eval))
    return <Text c="dimmed" p="md">No eval runs mapped to commits yet. Run an eval first.</Text>;
  // the list is newest first: default = the last two commits, older one is `from`
  const sel = (picked ?? commits.slice(0, 2).map((c) => c.hash)).filter((h) => commits.some((c) => c.hash === h));
  const order = (hs: string[]) => hs.slice().sort((a, b) => idx(commits, b) - idx(commits, a));
  const [from, to] = order(sel);
  const toggle = (h: string) =>
    setPicked((prev) => {
      const cur = (prev ?? sel).filter((x) => x !== h);
      return cur.length === (prev ?? sel).length ? [...cur.slice(-1), h] : cur;
    });
  return (
    <Stack gap={0} h="100%">
      <MetricChart
        // oldest left; non-trendable commits (partial/skipped runs) are hollow
        points={commits
          .slice()
          .reverse()
          .flatMap((c) =>
            c.eval?.score === undefined
              ? []
              : [{ key: c.hash, value: c.eval.score, hollow: !c.trendable, picked: sel.includes(c.hash), title: `${c.hash.slice(0, 7)} ${c.message}: ${score(c.eval.score)}` }],
          )}
        label="Score per commit"
        format={score}
        max={1}
        onPick={toggle}
        className={styles.spark}
      />
      <div className={styles.layout}>
        <div className={styles.list}>
          <CommitList commits={commits} picked={sel} onPick={toggle} />
        </div>
        <div className={styles.compare}>
          {from && to ? (
            <Compare spaceId={spaceId} from={from} to={to} />
          ) : (
            <Text c="dimmed" size="sm">Click two commits to compare.</Text>
          )}
        </div>
      </div>
    </Stack>
  );
}

const idx = (cs: VersionEntry[], h: string) => cs.findIndex((c) => c.hash === h);