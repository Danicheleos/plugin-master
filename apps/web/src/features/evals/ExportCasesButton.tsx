import { Button, Text } from '@mantine/core';
import { useExportCases } from './hooks';

/** The one "Export history" action of every case list: writes each case's run history into its case folder. */
export function ExportCasesButton({
  spaceId,
  cases,
  label = 'Export history',
  size = 'compact-xs',
}: {
  spaceId: string;
  /** Case names; empty = disabled. */
  cases: string[];
  label?: string;
  size?: 'compact-xs' | 'compact-sm';
}) {
  const exporter = useExportCases(spaceId);
  const sum = (k: 'written' | 'skipped') =>
    exporter.data?.exports.reduce((n, e) => n + e[k], 0);
  return (
    <>
      <Button
        size={size}
        variant="default"
        loading={exporter.isPending}
        disabled={!cases.length}
        onClick={(e) => {
          e.stopPropagation();
          exporter.mutate(cases);
        }}
      >
        {label}
      </Button>
      {exporter.data && (
        <Text size="xs" c="dimmed">
          {sum('written')} new, {sum('skipped')} unchanged in{' '}
          {exporter.data.exports.length} case folders
        </Text>
      )}
      {exporter.error && (
        <Text size="xs" c="red">
          {exporter.error.message}
        </Text>
      )}
    </>
  );
}
