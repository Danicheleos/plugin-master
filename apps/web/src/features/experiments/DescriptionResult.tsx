import { Alert, Badge, Code, Group, Table, Text } from '@mantine/core';
import type { Experiment } from '@pm/protocol';
import { cost, score } from '../evals/format';

const VERDICT_COLOR = { pass: 'green', fail: 'red', unknown: 'yellow' } as const;

/** Description optimizer outcome: verdict, candidates with train/holdout scores, original vs best text. */
export function DescriptionResult({ exp }: { exp: Experiment }) {
  const cands = exp.candidates ?? [];
  const r = exp.descriptionResult;
  const best = r ? cands[r.bestIndex] : undefined;
  return (
    <>
      <Group gap="xs">
        <Text size="sm">Skill <b>{exp.skill}</b></Text>
        <Text size="xs" c="dimmed">
          {exp.trainCases?.length ?? 0} train / {exp.holdoutCases?.length ?? 0} holdout cases
        </Text>
        {r && <Badge color={VERDICT_COLOR[r.verdict]} aria-label="verdict">{r.verdict}</Badge>}
      </Group>
      {r?.warning && <Alert color="yellow" p="xs" mt={4}>{r.warning}</Alert>}
      {cands.length > 0 && (
        <Table mt={4} withRowBorders={false}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>#</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th>Train</Table.Th>
              <Table.Th>Holdout</Table.Th>
              <Table.Th>Cost</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {cands.map((c, i) => (
              <Table.Tr key={i} fw={r?.bestIndex === i ? 700 : undefined}>
                <Table.Td>{i === 0 ? 'orig' : i}{r?.bestIndex === i ? ' *' : ''}</Table.Td>
                <Table.Td style={{ whiteSpace: 'pre-wrap' }}>{c.text}</Table.Td>
                <Table.Td>{score(c.train)}</Table.Td>
                <Table.Td>{score(c.holdout)}</Table.Td>
                <Table.Td>{cost(c.costUsd)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {best && r && r.bestIndex > 0 && (
        <>
          <Text size="xs" c="dimmed" mt={4}>Original</Text>
          <Code block c="red" fz="xs" style={{ whiteSpace: 'pre-wrap' }}>{`- ${cands[0]!.text}`}</Code>
          <Text size="xs" c="dimmed" mt={4}>Best (candidate {r.bestIndex})</Text>
          <Code block c="green" fz="xs" style={{ whiteSpace: 'pre-wrap' }}>{`+ ${best.text}`}</Code>
        </>
      )}
    </>
  );
}
