import { useState } from 'react';
import { Anchor, Group, Text } from '@mantine/core';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSpaceEvents } from '../api/ws';
import { ChatPanel } from '../features/chat/ChatPanel';
import { FileEditor } from '../features/files/FileEditor';
import { FileTree } from '../features/files/FileTree';
import { NewFileDialog } from '../features/files/NewFileDialog';
import { configKey } from '../features/context/hooks';
import { fileKey, treeKey } from '../features/files/hooks';
import { useSpaces } from '../features/spaces/hooks';
import { ColorSchemeToggle } from '../features/theme/ColorSchemeToggle';
import styles from './workspace.module.scss';

export function WorkspacePage() {
  const { id = '' } = useParams();
  const { data: spaces } = useSpaces();
  const space = spaces?.find((s) => s.id === id);
  const [params, setParams] = useSearchParams();
  const file = params.get('file');
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();

  useSpaceEvents(id, (msg) => {
    if (msg.type !== 'fs.changed') return;
    if (msg.path === '.plugin-master/config.json')
      void qc.invalidateQueries({ queryKey: configKey(id) });
    if (msg.event === 'change') {
      if (msg.path === file)
        void qc.invalidateQueries({ queryKey: fileKey(id, msg.path) });
    } else {
      void qc.invalidateQueries({ queryKey: treeKey(id) });
      if (msg.event === 'unlink' && msg.path === file)
        void qc.invalidateQueries({ queryKey: fileKey(id, msg.path) });
    }
  });

  const select = (path: string) => setParams({ file: path });

  return (
    <div className={styles.page}>
      <Group component="header" className={styles.header}>
        <Anchor component={Link} to="/">
          ← Back to list
        </Anchor>
        <Text fw={600} flex={1}>
          {space?.name ?? id}
        </Text>
        <ColorSchemeToggle />
      </Group>
      <FileTree
        spaceId={id}
        selected={file}
        onSelect={select}
        onNew={() => setCreating(true)}
      />
      <main className={styles.editor}>
        {file ? (
          <FileEditor spaceId={id} path={file} />
        ) : (
          <Text p="md" c="dimmed">
            Select a file
          </Text>
        )}
      </main>
      <aside className={styles.chat}>
        <ChatPanel spaceId={id} />
      </aside>
      {creating && (
        <NewFileDialog
          spaceId={id}
          onClose={() => setCreating(false)}
          onCreated={(path) => {
            setCreating(false);
            select(path);
          }}
        />
      )}
    </div>
  );
}
