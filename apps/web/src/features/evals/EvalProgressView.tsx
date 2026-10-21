import { Group, Progress, Stack, Text } from '@mantine/core';
import type { EvalCaseState, EvalProgress } from '@pm/protocol';

const ICON: Record<EvalCaseState, { mark: string; color: string }> = {
  queued: { mark: '○', color: 'dimmed' },
  running: { mark: '▶', color: 'blue' },
  done: { mark: '✓', color: 'green' },
  failed: { mark: '✗', color: 'red' },
  cancelled: { mark: '–', color: 'yellow' },
};

/** Overall bar ("N of M cases") and a compact per-case list with state and score. */
export function EvalProgressView({ progress }: { progress: EvalProgress }) {
  const { total, done, cases } = progress;
  return (
    <Stack gap={4}>
      <Group gap="xs" wrap="nowrap">
        <Progress
          flex={1}
          size="sm"
          value={total ? (done / total) * 100 : 0}
          aria-label="Eval progress"
        />
        <Text size="xs">
          {done} of {total} cases
        </Text>
      </Group>
      <Stack gap={0} mah={120} style={{ overflow: 'auto' }}>
        {cases.map((c) => (
          <Group key={c.name} gap="xs" wrap="nowrap">
            <Text size="xs" c={ICON[c.state].color} w={12} title={c.state}>
              {ICON[c.state].mark}
            </Text>
            <Text size="xs" flex={1} truncate>
              {c.name}
            </Text>
            <Text size="xs" c="dimmed">
              {c.score !== undefined ? c.score.toFixed(2) : c.state}
            </Text>
          </Group>
        ))}
      </Stack>
    </Stack>
  );
}
