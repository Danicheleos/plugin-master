import { useState } from 'react';
import { Anchor, Badge, Group, Stack, Text } from '@mantine/core';
import { LOOP_STAGES, type Experiment, type LoopStage, type StageInfo } from '@pm/protocol';
import { cost, duration } from '../evals/format';
import { RunTraceModal } from '../runs/RunsList';

const stageState = (s?: StageInfo) =>
  !s ? ['pending', 'gray'] : s.error ? ['failed', 'red'] : s.endedAt ? ['done', 'green'] : ['running', 'blue'];

const seconds = (s: StageInfo) =>
  s.endedAt ? (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000 : undefined;

/** The loop stages; a stage with a recorded SDK run links to its trace (the eval stage's id is a result dir). */
export function Stages({ spaceId, exp }: { spaceId: string; exp: Experiment }) {
  const [open, setOpen] = useState<LoopStage | null>(null);
  const runId = open && exp.stages?.[open]?.runId;
  // the optimizer runs propose and eval (once per iteration, this shows the current one); the loop the other four
  const names = LOOP_STAGES.filter((n) => (exp.kind === 'description' ? n === 'propose' || n === 'eval' : n !== 'propose'));
  return (
    <Stack gap={4}>
      {names.map((name) => {
        const s = exp.stages?.[name];
        const [label, color] = stageState(s);
        return (
          <div key={name}>
            <Group gap="xs">
              <Text size="sm" w={80}>{name}</Text>
              <Badge size="sm" color={color}>{label}</Badge>
              {s && <Text size="xs" c="dimmed">{cost(s.costUsd)} · {duration(seconds(s))}</Text>}
              {s?.runId && name !== 'eval' && (
                <Anchor component="button" type="button" size="xs" onClick={() => setOpen(name)}>
                  trace
                </Anchor>
              )}
            </Group>
            {s?.error && <Text size="xs" c="red">{s.error}</Text>}
          </div>
        );
      })}
      {runId && <RunTraceModal spaceId={spaceId} runId={runId} title={`${exp.branch} ${open}`} onClose={() => setOpen(null)} />}
    </Stack>
  );
}
