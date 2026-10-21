import { useState } from 'react';
import { Badge, Group, Select, Table, Text } from '@mantine/core';
import type { LedgerRecord } from '@pm/protocol';
import { SuiteVerdict } from '../evals/SuiteVerdict';
import { useLedger } from './hooks';

const MERGED = (m: LedgerRecord['merged']) => (m === null ? 'undecided' : m ? 'merged' : 'discarded');

/** What past experiments taught, newest first; filter by skill. */
export function Ledger({ spaceId }: { spaceId: string }) {
  const { data } = useLedger(spaceId);
  const [skill, setSkill] = useState<string | null>(null);
  if (!data?.length) return null;
  const skills = [...new Set(data.flatMap((r) => r.skills))].sort();
  const rows = data.filter((r) => !skill || r.skills.includes(skill)).reverse();
  return (
    <>
      <Group p="xs" justify="space-between">
        <Text fw={600} size="sm">Ledger</Text>
        {skills.length > 0 && (
          <Select size="xs" placeholder="All skills" aria-label="ledger skill" clearable data={skills} value={skill} onChange={setSkill} />
        )}
      </Group>
      <Table aria-label="ledger">
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td><Text size="xs">{r.at.slice(0, 10)}</Text></Table.Td>
              <Table.Td><Badge size="xs" variant="outline">{r.changeType}</Badge></Table.Td>
              <Table.Td>
                <Text size="sm">{r.hypothesis}</Text>
                {r.lesson && <Text size="xs" c="dimmed">{r.lesson}</Text>}
              </Table.Td>
              <Table.Td>
                {r.suite ? <SuiteVerdict suite={r.suite} /> : '-'}
              </Table.Td>
              <Table.Td><Text size="xs">{MERGED(r.merged)}</Text></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </>
  );
}
