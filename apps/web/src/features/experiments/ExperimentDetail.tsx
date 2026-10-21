import { useState } from 'react';
import { Badge, Button, Code, Group, List, Paper, Stack, Text, Title } from '@mantine/core';
import type { Experiment } from '@pm/protocol';
import { ApiAlert } from './ApiAlert';
import { Comparison } from './Comparison';
import { DescriptionResult } from './DescriptionResult';
import { ExperimentDiffView } from './ExperimentDiffView';
import { MergeDialog, DiscardDialog } from './Dialogs';
import { Stages } from './Stages';
import { useExperimentAction } from './hooks';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Paper withBorder p="xs">
    <Title order={6} mb={4}>{title}</Title>
    {children}
  </Paper>
);

/** Everything known about one experiment plus its actions. */
export function ExperimentDetail({ spaceId, exp }: { spaceId: string; exp: Experiment }) {
  const [dialog, setDialog] = useState<'merge' | 'discard' | null>(null);
  const cancel = useExperimentAction(spaceId, exp.id, 'cancel');
  const closable = ['ready', 'failed', 'created'].includes(exp.status);
  const { plan, execution, analysis } = exp;
  const desc = exp.kind === 'description';
  return (
    <Stack gap="xs" p="xs">
      <Group>
        <Text fw={600}>{exp.branch}</Text>
        {exp.status === 'running' && (
          <Button size="compact-xs" variant="default" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel</Button>
        )}
        {closable && <Button size="compact-xs" onClick={() => setDialog('merge')}>{desc ? 'Accept (merge)' : 'Merge'}</Button>}
        {closable && <Button size="compact-xs" color="red" variant="default" onClick={() => setDialog('discard')}>{desc ? 'Reject (discard)' : 'Discard'}</Button>}
      </Group>
      {cancel.error && <ApiAlert error={cancel.error} />}
      {exp.error && <Text size="sm" c="red">{exp.error}</Text>}
      <Stages spaceId={spaceId} exp={exp} />
      {desc && <Section title="Description"><DescriptionResult exp={exp} /></Section>}
      {plan && (
        <Section title={`Hypothesis: ${plan.title}`}>
          <Text size="sm">{plan.rationale}</Text>
          {plan.expectedEffect.length > 0 && (
            <List size="xs" mt={4}>
              {plan.expectedEffect.map((e) => <List.Item key={e.case}>{e.case}: {e.effect}</List.Item>)}
            </List>
          )}
          {plan.files.length > 0 && <Text size="xs" c="dimmed" mt={4}>Files: {plan.files.join(', ')}</Text>}
        </Section>
      )}
      {execution && <Section title="Executor"><Text size="sm">{execution.summary}</Text></Section>}
      {exp.comparison && <Section title="Eval"><Comparison data={exp.comparison} /></Section>}
      {analysis && (
        <Section title="Analyst">
          <Group gap="xs">
            <Badge color={analysis.verdict === 'improve' ? 'green' : analysis.verdict === 'regress' ? 'red' : 'gray'}>{analysis.verdict}</Badge>
            <Text size="sm">Recommendation: {analysis.recommendation}</Text>
          </Group>
          <List size="xs" mt={4}>
            {analysis.reasons.map((r) => <List.Item key={r}>{r}</List.Item>)}
          </List>
          {analysis.cases.map((c) => <Text key={c.case} size="xs"><b>{c.case}</b>: {c.note}</Text>)}
        </Section>
      )}
      {exp.stateProposal && (
        <Section title="Proposal (appended to STATE.md on merge)">
          <Code block fz="xs" style={{ whiteSpace: 'pre-wrap' }}>{exp.stateProposal}</Code>
        </Section>
      )}
      {closable && <Section title="Changed files"><ExperimentDiffView spaceId={spaceId} n={exp.id} /></Section>}
      {dialog === 'merge' && <MergeDialog spaceId={spaceId} n={exp.id} onClose={() => setDialog(null)} />}
      {dialog === 'discard' && <DiscardDialog spaceId={spaceId} n={exp.id} onClose={() => setDialog(null)} />}
    </Stack>
  );
}
