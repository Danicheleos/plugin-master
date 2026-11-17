import { useEffect, useState } from 'react';
import { Button, Group, Loader, NativeSelect, Text } from '@mantine/core';
import { useFile } from '../files';
import { skillPath } from './paths';
import { SkillEditor } from './SkillEditor';
import { useSkillNames } from './hooks';
import { NewSkillDialog } from './NewSkillDialog';
import { OptimizeDescription } from './OptimizeDescription';
import { QueryError } from '../../shared/ui/QueryError';

type Props = { spaceId: string; onWatch?: (paths: string[]) => void };

/** Block outline, editing and lint of each skill's SKILL.md. */
export function SkillsWidget({ spaceId, onWatch }: Props) {
  const names = useSkillNames(spaceId);
  const [picked, setPicked] = useState('');
  const [creating, setCreating] = useState(false);
  const list = names.data ?? [];
  const name = list.includes(picked) ? picked : (list[0] ?? '');
  const file = useFile(spaceId, skillPath(name));
  const watch = JSON.stringify(
    name ? ['skills', `skills/${name}`, `skills/${name}/SKILL.md`] : [],
  );
  useEffect(() => onWatch?.(JSON.parse(watch) as string[]), [watch, onWatch]);

  if (names.error) return <QueryError error={names.error} p="md" />;
  if (!names.data) return <Loader m="md" size="sm" />;
  const dialog = creating && (
    <NewSkillDialog
      spaceId={spaceId}
      existing={list}
      onCreated={(n) => {
        setPicked(n);
        setCreating(false);
      }}
      onClose={() => setCreating(false)}
    />
  );
  const newButton = (
    <Button size="xs" variant="default" onClick={() => setCreating(true)}>
      New skill
    </Button>
  );
  if (!name)
    return (
      <Group p="md">
        <Text c="dimmed">No skills (skills/*/SKILL.md)</Text>
        {newButton}
        {dialog}
      </Group>
    );
  return (
    <>
      <Group px="xs" gap="xs" wrap="nowrap">
        <NativeSelect
          aria-label="Skill"
          style={{ flex: 1 }}
          data={list}
          value={name}
          onChange={(e) => setPicked(e.currentTarget.value)}
        />
        {newButton}
        <OptimizeDescription spaceId={spaceId} skill={name} />
      </Group>
      {dialog}
      {file.data ? (
        <SkillEditor
          key={name}
          spaceId={spaceId}
          name={name}
          disk={file.data.content}
          others={list.filter((n) => n !== name)}
        />
      ) : file.error ? (
        <QueryError error={file.error} p="md" />
      ) : (
        <Loader m="md" size="sm" />
      )}
    </>
  );
}
