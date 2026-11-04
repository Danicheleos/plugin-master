import { useState } from 'react';
import { Alert, Badge, Group, Stack, Tabs, Text } from '@mantine/core';
import type { CaseSide, GateStatus, VersionsGate } from '@pm/protocol';
import { caseCompareColumns } from '../evals/columns';
import { DataTable } from '../evals/DataTable';
import { SuiteVerdict } from '../evals/SuiteVerdict';
import { TraceModal } from '../evals/TraceView';
import type { TraceTarget } from '../evals/hooks';
import { DiffView } from '../git/DiffPane';
import { FileDiffList } from '../git/FileDiffList';
import { useVersionsCompare, useVersionsDiff, useVersionsGate } from './hooks';

const COLOR: Record<GateStatus, string> = {
  pass: 'green',
  fail: 'red',
  unknown: 'gray',
};

/** Compare pane of two commits: changed files with their commit-to-commit diff, cases, gate. */
export function Compare({
  spaceId,
  from,
  to,
}: {
  spaceId: string;
  from: string;
  to: string;
}) {
  const { data, error } = useVersionsCompare(spaceId, from, to);
  const gate = useVersionsGate(spaceId, from, to, !!data);
  const [trace, setTrace] = useState<TraceTarget | null>(null);
  if (error)
    return (
      <Text c="red" size="sm">
        {error.message}
      </Text>
    );
  if (!data) return null;
  const open = (side: CaseSide | undefined, name: string) =>
    side?.runId &&
    side.arm &&
    side.n &&
    setTrace({ runId: side.runId, case: name, arm: side.arm, n: side.n });
  const columns = caseCompareColumns({ onTrace: open });
  return (
    <>
      <Group gap="xs" mb="xs">
        <Text size="sm" ff="monospace">
          {from.slice(0, 7)} → {to.slice(0, 7)}
        </Text>
        {gate.data && (
          <Badge
            color={COLOR[gate.data.status]}
            aria-label="gate status"
          >{`gate: ${gate.data.status}`}</Badge>
        )}
      </Group>
      <SuiteVerdict suite={data.suite} />
      <Tabs defaultValue="cases" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="files">{`Files (${data.files.length})`}</Tabs.Tab>
          <Tabs.Tab value="cases">{`Cases (${data.cases.length})`}</Tabs.Tab>
          <Tabs.Tab value="gate">Gate</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="files" pt="xs">
          <FileDiffList
            key={`${from}..${to}`} // a new pair of commits closes the open diff
            files={data.files}
            diff={(path) => (
              <VersionsDiff spaceId={spaceId} from={from} to={to} path={path} />
            )}
          />
        </Tabs.Panel>
        <Tabs.Panel value="cases" pt="xs">
          {data.cases.length ? (
            <DataTable
              kind="compare-versions"
              columns={columns}
              rows={data.cases}
              rowKey={(c) => c.name}
            />
          ) : (
            <Text size="sm" c="dimmed">
              No cases to compare.
            </Text>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="gate" pt="xs">
          <Gate gate={gate.data} error={gate.error} />
        </Tabs.Panel>
      </Tabs>
      {trace && (
        <TraceModal
          spaceId={spaceId}
          target={trace}
          onClose={() => setTrace(null)}
        />
      )}
    </>
  );
}

function VersionsDiff({
  spaceId,
  from,
  to,
  path,
}: {
  spaceId: string;
  from: string;
  to: string;
  path: string;
}) {
  const { data, error } = useVersionsDiff(spaceId, from, to, path);
  if (error)
    return (
      <Text c="red" size="sm">
        {error.message}
      </Text>
    );
  return data ? (
    <DiffView data={data} label={[from.slice(0, 7), to.slice(0, 7)]} />
  ) : null;
}

function Gate({ gate, error }: { gate?: VersionsGate; error: Error | null }) {
  if (error)
    return (
      <Text c="red" size="sm">
        {error.message}
      </Text>
    );
  if (!gate) return null;
  return (
    <Stack gap="xs">
      {gate.rules.map((r) => (
        <Group key={r.id} gap="xs" align="flex-start" wrap="nowrap">
          <Badge color={COLOR[r.status]} w={70}>
            {r.status}
          </Badge>
          <div>
            <Text size="sm">
              {r.id}: {r.message}
            </Text>
            {r.cases && (
              <Text size="xs" c="dimmed">
                {r.cases.join(', ')}
              </Text>
            )}
          </div>
        </Group>
      ))}
      {gate.warnings.map((w) => (
        <Alert key={w} color="yellow" p="xs">
          {w}
        </Alert>
      ))}
    </Stack>
  );
}
