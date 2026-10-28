import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Loader,
  Text,
  useComputedColorScheme,
} from '@mantine/core';
import MonacoEditor from '@monaco-editor/react';
import { ApiError } from '../../api/http';
import { useQueryClient } from '@tanstack/react-query';
import { fileKey, useCreateFile, useFile, useSaveFile } from './hooks';
import { useDraft } from './useDraft';
import styles from './files.module.scss';

const LANGUAGES: Record<string, string> = {
  md: 'markdown',
  json: 'json',
  ts: 'typescript',
  js: 'javascript',
  yaml: 'yaml',
  yml: 'yaml',
};
const languageOf = (path: string) =>
  LANGUAGES[path.split('.').pop() ?? ''] ?? 'plaintext';

type Props = { spaceId: string; path: string };

export function FileEditor({ spaceId, path }: Props) {
  const { data, error } = useFile(spaceId, path);
  // keep a loaded editor (and its unsaved edits) even if a refetch fails
  if (data)
    return (
      <Editor
        key={path}
        spaceId={spaceId}
        path={path}
        disk={data.content}
        gone={error instanceof ApiError && error.status === 404}
      />
    );
  if (error instanceof ApiError && error.status === 415)
    return (
      <Text p="md" c="dimmed">
        Binary files are not displayed
      </Text>
    );
  if (error)
    return (
      <Text p="md" c="red">
        {error.message}
      </Text>
    );
  return <Loader m="md" size="sm" />;
}

/** `disk` is the latest server content; the draft tracks the last disk content the editor accepted. */
function Editor({
  spaceId,
  path,
  disk,
  gone,
}: Props & { disk: string; gone: boolean }) {
  const draft = useDraft(disk);
  // a file deleted on disk is saved by creating it again
  const save = useSaveFile(spaceId);
  const create = useCreateFile(spaceId);
  const writer = gone ? create : save;
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const scheme = useComputedColorScheme('light');

  const saveNow = () =>
    writer.mutate(
      { path, content: draft.value },
      {
        onSuccess: () => {
          // state first, then cache: the cache update re-renders with disk === value
          draft.saved(draft.value);
          setEditing(false);
          qc.setQueryData(fileKey(spaceId, path), { path, content: draft.value });
        },
      },
    );
  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;

  return (
    <div className={styles.editor}>
      <Group className={styles.header} justify="space-between" px="md" py={6}>
        <span>
          {path}
          {draft.dirty && ' ●'}
        </span>
        {editing && draft.dirty ? (
          <Button size="compact-sm" disabled={writer.isPending} onClick={saveNow}>
            Save
          </Button>
        ) : editing ? (
          <Button
            size="compact-sm"
            variant="default"
            onClick={() => setEditing(false)}
          >
            Close
          </Button>
        ) : (
          <Button size="compact-sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </Group>
      {writer.error && (
        <Text c="red" px="md">
          {writer.error.message}
        </Text>
      )}
      {gone && (
        <Alert color="yellow" radius={0}>
          File deleted on disk
        </Alert>
      )}
      {draft.conflict && (
        <Alert color="yellow" radius={0}>
          <Group>
            <span>File changed on disk</span>
            <Button
              size="compact-sm"
              variant="default"
              onClick={draft.reload}
            >
              Reload
            </Button>
            <Button
              size="compact-sm"
              variant="default"
              onClick={draft.accept}
            >
              Keep my edits
            </Button>
          </Group>
        </Alert>
      )}
      <MonacoEditor
        path={path}
        theme={scheme === 'dark' ? 'vs-dark' : 'vs'}
        language={languageOf(path)}
        value={draft.value}
        onChange={(v) => draft.setValue(v ?? '')}
        onMount={(editor, monaco) =>
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
            saveRef.current(),
          )
        }
        options={{ minimap: { enabled: false }, wordWrap: 'on', readOnly: !editing,
          // sets `readonly` on the input textarea, so focus does not open the touch keyboard
          domReadOnly: !editing,
        }}
      />
    </div>
  );
}
