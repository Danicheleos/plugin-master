import { useState } from 'react';
import { Alert, Badge, Button, Group, Stack, Table, Tabs, Text } from '@mantine/core';
import type { CaseCompare, CaseSide, GateStatus, VersionsGate } from '@pm/protocol';
import { cost, delta, score } from '../evals/format';
import { FlakyMark, SuiteVerdict } from '../evals/SuiteVerdict';
import { TraceModal } from '../evals/TraceView';
import type { TraceTarget } from '../evals/hooks';
import { useVersionsCompare, useVersionsGate } from './hooks';

const COLOR: Record<GateStatus, string> = { pass: 'green', fail: 'red', unknown: 'gray' };

/** Compare pane of two commits. Files are a plain list: the git diff API only has working tree vs HEAD. */
export function Compare({ spaceId, from, to }: { spaceId: string; from: string; to: string }) {
  const { data, error } = useVersionsCompare(spaceId, from, to);
  const gate = useVersionsGate(spaceId, from, to, !!data);
  const [trace, setTrace] = useState<TraceTarget | null>(null);
  if (error) return <Text c="red" size="sm">{error.message}</Text>;
  if (!data) return null;
  const open = (side: CaseSide | undefined, name: string) =>
    side?.runId && side.arm && side.n && setTrace({ runId: side.runId, case: name, arm: side.arm, n: side.n });
  return (
    <>
      <Group gap="xs" mb="xs">
        <Text size="sm" ff="monospace">{from.slice(0, 7)} → {to.slice(0, 7)}</Text>
        {gate.data && <Badge color={COLOR[gate.data.status]} aria-label="gate status">{`gate: ${gate.data.status}`}</Badge>}
      </Group>
      <SuiteVerdict suite={data.suite} />
      <Tabs defaultValue="cases" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="files">{`Files (${data.files.length})`}</Tabs.Tab>
          <Tabs.Tab value="cases">{`Cases (${data.cases.length})`}</Tabs.Tab>
          <Tabs.Tab value="gate">Gate</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="files" pt="xs">
          {data.files.length === 0 && <Text size="sm" c="dimmed">No changed files.</Text>}
          {data.files.map((f) => (
            <Group key={f.path} gap="xs">
              <Text size="xs" ff="monospace" w="2.5em">{f.status}</Text>
              <Text size="sm">{f.path}</Text>
            </Group>
          ))}
        </Tabs.Panel>
        <Tabs.Panel value="cases" pt="xs">
          <CasesTable cases={data.cases} onOpen={open} />
        </Tabs.Panel>
        <Tabs.Panel value="gate" pt="xs">
          <Gate gate={gate.data} error={gate.error} />
        </Tabs.Panel>
      </Tabs>
      {trace && <TraceModal spaceId={spaceId} target={trace} onClose={() => setTrace(null)} />}
    </>
  );
}

function CasesTable({ cases, onOpen }: { cases: CaseCompare[]; onOpen: (side: CaseSide | undefined, name: string) => void }) {
  if (!cases.length) return <Text size="sm" c="dimmed">No cases to compare.</Text>;
  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Case</Table.Th>
          <Table.Th>From</Table.Th>
          <Table.Th>To</Table.Th>
          <Table.Th>Δ</Table.Th>
          <Table.Th>Cost</Table.Th>
          <Table.Th>Traces</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {cases.map((c) => (
          <Table.Tr key={c.name}>
            <Table.Td>{c.name} {(c.from?.flaky || c.to?.flaky) && <FlakyMark />}</Table.Td>
            <Table.Td>{score(c.from?.score)}</Table.Td>
            <Table.Td>{score(c.to?.score)}</Table.Td>
            <Table.Td c={c.delta === undefined || c.delta === 0 ? undefined : c.delta < 0 ? 'red' : 'green'}>{delta(c.delta)}</Table.Td>
            <Table.Td>{cost(c.from?.costUsd)} → {cost(c.to?.costUsd)}</Table.Td>
            <Table.Td>
              <Group gap={4} wrap="nowrap">
                <Button size="compact-xs" variant="default" disabled={!c.from?.runId} onClick={() => onOpen(c.from, c.name)} aria-label={`from trace ${c.name}`}>from</Button>
                <Button size="compact-xs" variant="default" disabled={!c.to?.runId} onClick={() => onOpen(c.to, c.name)} aria-label={`to trace ${c.name}`}>to</Button>
              </Group>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function Gate({ gate, error }: { gate?: VersionsGate; error: Error | null }) {
  if (error) return <Text c="red" size="sm">{error.message}</Text>;
  if (!gate) return null;
  return (
    <Stack gap="xs">
      {gate.rules.map((r) => (
        <Group key={r.id} gap="xs" align="flex-start" wrap="nowrap">
          <Badge color={COLOR[r.status]} w={70}>{r.status}</Badge>
          <div>
            <Text size="sm">{r.id}: {r.message}</Text>
            {r.cases && <Text size="xs" c="dimmed">{r.cases.join(', ')}</Text>}
          </div>
        </Group>
      ))}
      {gate.warnings.map((w) => (
        <Alert key={w} color="yellow" p="xs">{w}</Alert>
      ))}
    </Stack>
  );
}
