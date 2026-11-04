import { Text } from '@mantine/core';
import { DiffView } from '../git/DiffPane';
import { FileDiffList } from '../git/FileDiffList';
import { useExperimentDiff } from './hooks';

/** Changed files of the branch against its base, with a read-only diff of the selected one. */
export function ExperimentDiffView({
  spaceId,
  n,
}: {
  spaceId: string;
  n: number;
}) {
  const { data, error } = useExperimentDiff(spaceId, n);
  if (error)
    return (
      <Text c="red" size="sm">
        {error.message}
      </Text>
    );
  if (!data) return null;
  return (
    <>
      <FileDiffList
        files={data.files}
        diff={(path) => {
          const f = data.files.find((x) => x.path === path);
          return f && <DiffView data={f} label={['base', 'exp']} />;
        }}
      />
      {data.truncated && (
        <Text size="xs" c="dimmed">
          Only the first files are listed.
        </Text>
      )}
    </>
  );
}
