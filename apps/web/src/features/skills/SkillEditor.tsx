import { useState } from 'react';
import { Alert, Button, Group, Text } from '@mantine/core';
import { insertBlock } from '@pm/protocol';
import { useCreateFile, useDraft, useSaveDraft } from '../files';
import { skillDir, skillPath } from './paths';
import { InsertDialog } from './InsertDialog';
import { LintPanel } from './LintPanel';
import { Outline } from './Outline';
import { useSkillFiles } from './hooks';
import { extractTo } from './ops';
import styles from './skills.module.scss';

type Props = { spaceId: string; name: string; disk: string; others: string[] };

/** Draft of one SKILL.md: block operations splice the draft text, Save writes it. */
export function SkillEditor({ spaceId, name, disk, others }: Props) {
  const path = skillPath(name);
  const draft = useDraft(disk);
  const files = useSkillFiles(spaceId, name).data;
  const saver = useSaveDraft(spaceId, path, draft);
  const create = useCreateFile(spaceId);
  const [error, setError] = useState<string | null>(null);
  const [inserting, setInserting] = useState(false);

  const run = async (fn: () => Promise<void> | void) => {
    try {
      setError(null);
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const apply = (fn: (t: string) => string) =>
    void run(() => draft.setValue(fn(draft.value)));
  const write = saver.write;
  // the sub-file first, so the saved link never dangles
  const extract = (id: string) =>
    run(async () => {
      const r = extractTo(draft.value, id, files ?? new Set());
      await create.mutateAsync({
        path: `${skillDir(name)}/${r.subFile.path}`,
        content: r.subFile.content,
      });
      draft.setValue(r.text);
      await write(r.text);
    });

  return (
    <>
      <Group justify="space-between" px="xs" py={4} wrap="nowrap">
        <Text size="sm" truncate>
          {path}
          {draft.dirty && ' ●'}
        </Text>
        <Group gap="xs" wrap="nowrap">
          <Button
            size="compact-xs"
            variant="default"
            disabled={others.length === 0}
            onClick={() => setInserting(true)}
          >
            Insert block from another skill
          </Button>
          <Button
            size="compact-xs"
            variant="default"
            disabled={!draft.dirty}
            onClick={draft.revert}
          >
            Revert
          </Button>
          <Button
            size="compact-xs"
            disabled={!draft.dirty || saver.isPending}
            onClick={() => run(() => write(draft.value))}
          >
            Save
          </Button>
        </Group>
      </Group>
      {error && (
        <Text c="red" size="sm" px="xs">
          {error}
        </Text>
      )}
      {draft.conflict && (
        <Alert color="yellow" radius={0} p="xs">
          <Group gap="xs">
            <span>File changed on disk</span>
            <Button size="compact-xs" variant="default" onClick={draft.reload}>
              Reload
            </Button>
            <Button
              size="compact-xs"
              variant="default"
              onClick={() => {
                draft.accept();
                void run(() => write(draft.value));
              }}
            >
              Overwrite
            </Button>
          </Group>
        </Alert>
      )}
      <div className={styles.scroll}>
        <Outline text={draft.value} apply={apply} onExtract={extract} />
        <LintPanel dirName={name} text={draft.value} files={files} />
      </div>
      {inserting && (
        <InsertDialog
          spaceId={spaceId}
          names={others}
          onClose={() => setInserting(false)}
          onInsert={(s) => apply((t) => insertBlock(t, null, 'after', s))}
        />
      )}
    </>
  );
}
