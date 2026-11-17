import { Group, Progress, Stack, Text } from '@mantine/core';
import type { EvalProgress } from '@pm/protocol';
import { score } from '../../shared/format';
import { CASE_STATE_ICON } from '../../shared/ui/status';

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
            <Text
              size="xs"
              c={CASE_STATE_ICON[c.state].color}
              w={12}
              title={c.state}
            >
              {CASE_STATE_ICON[c.state].mark}
            </Text>
            <Text size="xs" flex={1} truncate>
              {c.name}
            </Text>
            <Text size="xs" c="dimmed">
              {c.score !== undefined ? score(c.score) : c.state}
            </Text>
          </Group>
        ))}
      </Stack>
    </Stack>
  );
}
