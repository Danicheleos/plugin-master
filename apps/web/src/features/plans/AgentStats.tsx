import { Group, Progress, Text, Tooltip } from '@mantine/core';
import type { ContextUsage } from '@pm/protocol';
import { tokens } from '../evals/format';

/** Master context against the auto-compact threshold (else the window); the window is in the tooltip. */
export function ContextMeter({ usage }: { usage: ContextUsage }) {
  const { tokens: used, max, limit } = usage;
  const of = limit ?? max;
  const percent = of > 0 ? Math.round((used / of) * 100) : 0;
  return (
    <Tooltip
      label={`Context window ${tokens(max)} (${usage.percent}%)${limit === null ? ', auto-compact off' : `, auto-compact at ${tokens(limit)}`}`}
    >
      <Group gap="xs" wrap="nowrap">
        <Text size="xs">
          Context {tokens(used)} / {tokens(of)} ·{' '}
          {tokens(Math.max(0, of - used))} left
          {limit === null ? '' : ' (auto-compact)'}
        </Text>
        <Progress
          flex={1}
          size="sm"
          value={Math.min(100, percent)}
          color={percent >= 80 ? 'red' : undefined}
          aria-label="Master context"
        />
      </Group>
    </Tooltip>
  );
}
