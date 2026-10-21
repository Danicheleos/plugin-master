import { Badge, Group, Stack, Text } from '@mantine/core';
import { lintSkill } from '@pm/protocol';

const COLORS = { error: 'red', warning: 'yellow', info: 'blue' } as const;

/** Lint problems by severity plus size stats (tokens are a chars/4 estimate). */
export function LintPanel({ dirName, text, files }: { dirName: string; text: string; files?: Set<string> }) {
  const { problems, stats } = lintSkill({ dirName, text, existingFiles: files });
  return (
    <Stack gap={4} p="xs">
      <Text size="xs" c="dimmed">
        {stats.bodyLines} body lines · ~{stats.approxTokens} tokens (estimate) · description {stats.descriptionChars} chars · listing{' '}
        {stats.listingChars}/1536
      </Text>
      {problems.length === 0 && <Text size="sm">No problems</Text>}
      {(['error', 'warning', 'info'] as const).map((sev) =>
        problems
          .filter((p) => p.severity === sev)
          .map((p, i) => (
            <Group key={`${sev}${i}`} gap="xs" wrap="nowrap" align="flex-start">
              <Badge size="xs" color={COLORS[sev]}>{sev}</Badge>
              <Text size="sm"><b>{p.field}</b>: <span>{p.message}</span></Text>
            </Group>
          )),
      )}
    </Stack>
  );
}
