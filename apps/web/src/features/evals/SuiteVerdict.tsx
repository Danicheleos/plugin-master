import { Badge, Group, Text } from '@mantine/core';
import type { SuiteDelta } from '@pm/protocol';
import { deltaCi } from './format';

const COLOR = { improved: 'green', regressed: 'red', inconclusive: 'gray' } as const;

/** Suite-level mean delta with its 95% interval and the verdict; inconclusive is never shown as a win or a loss. */
export function SuiteVerdict({ suite }: { suite: SuiteDelta }) {
  return (
    <Group gap="xs" mb="xs">
      <Badge color={COLOR[suite.verdict]} aria-label="suite verdict">{suite.verdict}</Badge>
      <Text size="sm" ff="monospace">{deltaCi(suite.mean, suite.ci)}</Text>
      <Text size="xs" c="dimmed">{`${suite.cases} case(s)`}</Text>
    </Group>
  );
}

export const FlakyMark = () => (
  <Badge size="xs" color="yellow" variant="light" title="runs of this case disagree">flaky</Badge>
);
