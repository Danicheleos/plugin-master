import { useState } from 'react';
import { Alert, Button, Group, Modal, Stack, TextInput, Textarea } from '@mantine/core';
import { useCreateFile } from '../files/hooks';

type Props = { spaceId: string; existing: string[]; onCreated: (name: string) => void; onClose: () => void };

/** Same rules as `lintSkill`'s name check; null = valid. */
export function skillNameError(name: string, existing: string[]): string | null {
  if (!name) return 'Name is required';
  if (name.length > 64) return `Name is ${name.length} chars, max 64`;
  if (!/^[a-z0-9-]+$/.test(name)) return 'Only lowercase letters, digits and hyphens';
  if (existing.includes(name)) return `Skill "${name}" already exists`;
  return null;
}

/** SKILL.md of a new skill; JSON strings are valid YAML double-quoted scalars. */
export const skillTemplate = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${JSON.stringify(description.trim())}\n---\n\n# ${name}\n\nDescribe what the skill does and how.\n`;

/** Creates `skills/<name>/SKILL.md` (the server makes the directory). */
export function NewSkillDialog({ spaceId, existing, onCreated, onClose }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);
  const create = useCreateFile(spaceId);
  const error = skillNameError(name, existing);
  const desc = description.trim();
  const descError = !desc
    ? 'Description is required'
    : desc.length > 1024
      ? `Description is ${desc.length} chars, max 1024`
      : null;
  return (
    <Modal opened onClose={onClose} title="New skill">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (error || descError) return;
          create.mutate(
            { path: `skills/${name}/SKILL.md`, content: skillTemplate(name, description) },
            { onSuccess: () => onCreated(name) },
          );
        }}
      >
        <Stack>
          <TextInput
            label="Name"
            placeholder="my-skill"
            value={name}
            onChange={(e) => { setName(e.currentTarget.value); setTouched(true); }}
            error={touched && error}
            data-autofocus
          />
          <Textarea
            label="Description"
            placeholder="What the skill does and when to use it"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            error={touched && descError}
            autosize
            minRows={2}
          />
          {create.error && <Alert color="red">{create.error.message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={create.isPending}>Create</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
