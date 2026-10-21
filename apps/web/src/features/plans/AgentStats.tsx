import { Group, Progress, Text, Tooltip } from '@mantine/core';
import type { ContextUsage } from '@pm/protocol';

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** Master context against the auto-compact threshold (else the window); the window is in the tooltip. */
export function ContextMeter({ usage }: { usage: ContextUsage }) {
  const { tokens, max, limit } = usage;
  const of = limit ?? max;
  const percent = of > 0 ? Math.round((tokens / of) * 100) : 0;
  return (
    <Tooltip
      label={`Context window ${k(max)} (${usage.percent}%)${limit === null ? ', auto-compact off' : `, auto-compact at ${k(limit)}`}`}
    >
      <Group gap="xs" wrap="nowrap">
        <Text size="xs">
          Context {k(tokens)} / {k(of)} · {k(Math.max(0, of - tokens))} left
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
