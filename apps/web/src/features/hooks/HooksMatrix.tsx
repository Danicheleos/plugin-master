import { Badge, Table, Text, UnstyledButton } from '@mantine/core';
import { HOOK_SOURCES, type HookSource, type HooksResponse } from '@pm/protocol';
import styles from './hooks.module.scss';

/** Lifecycle sections; events in none of them go to "Other", unlisted names to "Unknown". */
const SECTIONS: [string, string[]][] = [
  ['Session', ['SessionStart', 'Setup', 'SessionEnd']],
  ['Prompt and turn', ['UserPromptSubmit', 'UserPromptExpansion', 'MessageDisplay', 'Stop', 'StopFailure']],
  ['Tool', ['PreToolUse', 'PermissionRequest', 'PermissionDenied', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch']],
  ['Subagent and task', ['SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted', 'TeammateIdle']],
  ['Compaction', ['PreCompact', 'PostCompact']],
];

type Props = { data: HooksResponse; onlyUsed: boolean; onCell: (event: string, source: HookSource) => void };

export function HooksMatrix({ data, onlyUsed, onCell }: Props) {
  const entries = (event: string, source?: HookSource) =>
    data.entries.filter((e) => e.event === event && (!source || e.source === source));
  const known = new Set<string>(data.events);
  const unknown = [...new Set(data.entries.map((e) => e.event).filter((e) => !known.has(e)))];
  const listed = new Set(SECTIONS.flatMap(([, ev]) => ev));
  const sections = [
    ...SECTIONS.map(([name, ev]) => [name, data.events.filter((e) => ev.includes(e))] as const),
    ['Other', data.events.filter((e) => !listed.has(e))] as const,
    ['Unknown', unknown] as const,
  ]
    .map(([name, evs]) => [name, onlyUsed ? evs.filter((e) => entries(e).length > 0) : evs] as const)
    .filter(([, evs]) => evs.length > 0);

  return (
    <Table stickyHeader>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Event</Table.Th>
          {HOOK_SOURCES.map((s) => {
            const rows = data.sources.filter((r) => r.source === s);
            const broken = rows.filter((r) => r.error);
            return (
              <Table.Th key={s} ta="center">
                {s}
                <Text size="xs" c="dimmed" fw={400}>{rows.filter((r) => r.exists).length} files</Text>
                {broken.map((r) => (
                  <Badge key={r.file} color="red" size="xs" title={`${r.file}: ${r.error}`}>error</Badge>
                ))}
              </Table.Th>
            );
          })}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {sections.map(([name, evs]) => [
          <Table.Tr key={name}>
            <Table.Td colSpan={HOOK_SOURCES.length + 1}><Text size="xs" fw={600} c="dimmed" tt="uppercase">{name}</Text></Table.Td>
          </Table.Tr>,
          ...evs.map((event) => {
            const problems = entries(event).flatMap((e) => e.problems);
            return (
              <Table.Tr key={event}>
                <Table.Td>
                  {event}
                  {problems.length > 0 && (
                    <Badge ml="xs" color="red" size="xs" title={problems.map((p) => p.message).join('\n')}>problem</Badge>
                  )}
                </Table.Td>
                {HOOK_SOURCES.map((s) => {
                  const es = entries(event, s);
                  const count = es.reduce((n, e) => n + e.handlers.length, 0);
                  return (
                    <Table.Td key={s} p={0}>
                      <UnstyledButton
                        className={`${styles.cell} ${es.length ? styles.filled : styles.empty}`}
                        aria-label={`${event} ${s}: ${count}`}
                        onClick={() => onCell(event, s)}
                      >
                        {es.length ? count : '·'}
                      </UnstyledButton>
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            );
          }),
        ])}
      </Table.Tbody>
    </Table>
  );
}
