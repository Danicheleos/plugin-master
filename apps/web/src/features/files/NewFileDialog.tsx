import { useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  TextInput,
} from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import type { FileNode } from '@pm/protocol';
import { treeKey, useCreateFile } from './hooks';

type Props = {
  spaceId: string;
  onCreated: (path: string) => void;
  onClose: () => void;
};

const ROOT = '/';

/** Directories whose listing is already loaded (root and expanded ones show their subdirectories). */
const loadedDirs = (lists: (FileNode[] | undefined)[]): string[] =>
  lists
    .flatMap((l) => l ?? [])
    .flatMap((n) => (n.type === 'dir' ? [n.path] : []));

export function NewFileDialog({ spaceId, onCreated, onClose }: Props) {
  const [folder, setFolder] = useState(ROOT);
  const [name, setName] = useState('');
  const qc = useQueryClient();
  const dirs = loadedDirs(
    qc
      .getQueriesData<FileNode[]>({ queryKey: treeKey(spaceId) })
      .map(([, d]) => d),
  ).sort();
  const create = useCreateFile(spaceId);
  const path = folder === ROOT ? name : `${folder}/${name}`;
  return (
    <Modal opened onClose={onClose} title="New file">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { path, content: '' },
            { onSuccess: () => onCreated(path) },
          );
        }}
      >
        <Stack>
          <Select
            label="Folder"
            data={[{ value: ROOT, label: '(root)' }, ...dirs]}
            value={folder}
            onChange={(v) => setFolder(v ?? ROOT)}
            allowDeselect={false}
            searchable
          />
          <TextInput
            label="File name"
            value={name}
            placeholder="SKILL.md"
            onChange={(e) => setName(e.target.value)}
            required
            data-autofocus
          />
          {create.error && <Alert color="red">{create.error.message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
