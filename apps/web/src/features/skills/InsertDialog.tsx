import { useState } from 'react';
import { Button, Group, Modal, NativeSelect, Stack, Text } from '@mantine/core';
import { useFile } from '../files/hooks';
import { sectionText, sections } from './ops';

type Props = { spaceId: string; names: string[]; onInsert: (section: string) => void; onClose: () => void };

/** Picks a block of another skill; it is appended to the end of the current one. */
export function InsertDialog({ spaceId, names, onInsert, onClose }: Props) {
  const [name, setName] = useState(names[0] ?? '');
  const [id, setId] = useState('');
  const { data } = useFile(spaceId, `skills/${name}/SKILL.md`);
  const blocks = data ? sections(data.content).filter((b) => b.kind === 'section') : [];
  const chosen = blocks.find((b) => b.id === id) ?? blocks[0];
  return (
    <Modal opened onClose={onClose} title="Insert block from another skill">
      <Stack>
        {names.length === 0 && <Text c="dimmed">No other skills</Text>}
        <NativeSelect label="Skill" data={names} value={name} onChange={(e) => { setName(e.currentTarget.value); setId(''); }} />
        <NativeSelect
          label="Block"
          data={blocks.map((b) => ({ value: b.id, label: `${'  '.repeat(b.level - 1)}${b.title}` }))}
          value={chosen?.id ?? ''}
          onChange={(e) => setId(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button disabled={!chosen || !data} onClick={() => { onInsert(sectionText(data!.content, chosen!.id)); onClose(); }}>
            Insert
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
