import { useEffect, useState } from 'react';
import { Badge, Group, Stack, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import type { EvalProgress, ExternalSeries } from '@pm/protocol';
import { EvalProgressView } from './EvalProgressView';
import { evalsKey } from './hooks';

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${m}:${String(s % 60).padStart(2, '0')}`;
};

const toProgress = (s: ExternalSeries): EvalProgress => ({
  total: s.total,
  done: s.done,
  current: s.current,
  cases: s.cases.map((c) => ({
    name: c.name,
    state: c.state,
    ...(c.score === null ? {} : { score: c.score }),
  })),
});

/** A series started outside plugin-master, from `results/running.json`; refreshes the runs list when it finishes. */
export function ExternalSeriesView({ spaceId, series }: { spaceId: string; series: ExternalSeries }) {
  const qc = useQueryClient();
  const finished = series.finishedAt !== null;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (finished) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [finished]);
  useEffect(() => {
    if (finished) void qc.invalidateQueries({ queryKey: evalsKey(spaceId) });
  }, [finished, qc, spaceId]);
  const end = series.finishedAt ? Date.parse(series.finishedAt) : now;
  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Badge color={finished ? 'green' : 'blue'}>{finished ? 'finished (external)' : 'running (external)'}</Badge>
        <Text size="xs" c="dimmed">
          {series.series} · {series.arm} · {series.runsPerCase} runs per case · ${series.costUsd.toFixed(2)} so far ·{' '}
          {clock(end - Date.parse(series.startedAt))}
        </Text>
      </Group>
      <EvalProgressView progress={toProgress(series)} />
    </Stack>
  );
}
