import { Text } from '@mantine/core';
import { DiffView } from '../../shared/diff/DiffView';
import { useGitDiff } from './hooks';

/** HEAD vs working tree of one file (read-only). */
export function DiffPane({ spaceId, path }: { spaceId: string; path: string }) {
  const { data, error } = useGitDiff(spaceId, path);
  if (error)
    return (
      <Text c="red" size="sm" p="xs">
        {error.message}
      </Text>
    );
  return data ? <DiffView data={data} /> : null;
}
