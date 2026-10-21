import { Anchor, Badge, Button, Group, Text } from '@mantine/core';
import type { EvalTarget } from '@pm/protocol';
import { CasesTable, entryFromRuns } from './EvalSuitesList';
import { deltaColor, type OpenCase } from './columns';
import { MetricGrid } from './MetricGrid';
import { useEvalTargets, useExportCases } from './hooks';
import { useEvalPrefs, useOpen } from './prefs';
import { delta, score, scoreColor } from './format';
import styles from './evals.module.scss';

const bytes = (n?: number) =>
  n === undefined ? '-' : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;

/** Skills and agents of the plugin with the trends of their eval cases (see server `evals/targets.ts`). */
export function EvalTargetsList({
  spaceId,
  onOpen,
}: {
  spaceId: string;
  onOpen: OpenCase;
}) {
  const { data, error } = useEvalTargets(spaceId);
  const [{ limit: max }] = useEvalPrefs();
  if (error) return <Text c="red">{error.message}</Text>;
  if (!data) return null;
  if (!data.targets.length && !data.unmapped.cases.length)
    return (
      <Text c="dimmed" size="sm">
        No eval cases to map. A case belongs to a skill or agent via a tag
        `skill:&lt;name&gt;` / `agent:&lt;name&gt;` or a `tool_used` grader
        naming it.
      </Text>
    );
  return (
    <>
      {data.targets.map((t) => (
        <Target
          key={`${t.kind}:${t.name}`}
          spaceId={spaceId}
          t={t}
          kind={t.kind}
          limit={max}
          onOpen={onOpen}
        />
      ))}
      {data.unmapped.cases.length > 0 && (
        <Target
          spaceId={spaceId}
          t={data.unmapped}
          limit={max}
          onOpen={onOpen}
        />
      )}
    </>
  );
}

function Target({
  spaceId,
  t,
  kind,
  limit,
  onOpen,
}: {
  spaceId: string;
  t: EvalTarget;
  kind?: 'skill' | 'agent';
  limit?: number;
  onOpen: OpenCase;
}) {
  const key = `target:${kind ?? 'unmapped'}:${t.name}`;
  const [open, toggle] = useOpen(key);
  const latest = t.runs[0];
  const exporter = useExportCases(spaceId);
  return (
    <section className={styles.suite}>
      <Group gap="xs" mb="xs">
        <Anchor
          component="button"
          fw={600}
          aria-expanded={open}
          onClick={toggle}
        >
          {open ? '▾' : '▸'} {t.name}
        </Anchor>
        <Badge
          variant="light"
          color={kind === 'agent' ? 'grape' : kind ? 'blue' : 'gray'}
        >
          {kind ?? 'unmapped'}
        </Badge>
        <Text size="xs" c="dimmed">
          {t.cases.length} cases
        </Text>
        <Text size="sm" c={scoreColor(latest?.score)}>
          {score(latest?.score)}
        </Text>
        <Text size="sm" c={deltaColor(latest?.delta)}>
          {delta(latest?.delta)}
        </Text>
        <Button
          size="compact-xs"
          variant="default"
          loading={exporter.isPending}
          onClick={() => exporter.mutate(t.cases.map((c) => c.name))}
        >
          Export history
        </Button>
        {exporter.data && (
          <Text size="xs" c="dimmed">
            {exporter.data.exports.reduce((n, e) => n + e.written, 0)} new,{' '}
            {exporter.data.exports.reduce((n, e) => n + e.skipped, 0)} unchanged
            in {exporter.data.exports.length} case folders
          </Text>
        )}
        {exporter.error && (
          <Text size="xs" c="red">
            {exporter.error.message}
          </Text>
        )}
        {kind && (
          <Text size="xs" c="dimmed">
            context {bytes(t.contextBytes)}
          </Text>
        )}
      </Group>
      {open && (
        <>
          <MetricGrid runs={t.runs} />
          <CasesTable
            spaceId={spaceId}
            cases={t.cases.map((c) =>
              entryFromRuns(c.name, c.runs.slice(0, limit)),
            )}
            openKey={key}
            showHeader={false}
            onOpen={onOpen}
          />
        </>
      )}
    </section>
  );
}
