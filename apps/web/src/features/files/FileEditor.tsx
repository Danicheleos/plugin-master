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

/** `disk` is the latest server content; `base` is the last disk content the editor has accepted. */
function Editor({
  spaceId,
  path,
  disk,
  gone,
}: Props & { disk: string; gone: boolean }) {
  const [value, setValue] = useState(disk);
  const [base, setBase] = useState(disk);
  const [seenDisk, setSeenDisk] = useState(disk);
  const [conflict, setConflict] = useState(false);
  // a file deleted on disk is saved by creating it again
  const save = useSaveFile(spaceId);
  const create = useCreateFile(spaceId);
  const writer = gone ? create : save;
  const qc = useQueryClient();
  const dirty = value !== base;
  const scheme = useComputedColorScheme('light');

  // External change: reload silently when clean, otherwise ask.
  if (disk !== seenDisk) {
    setSeenDisk(disk);
    if (disk !== base) {
      if (dirty) setConflict(true);
      else {
        setValue(disk);
        setBase(disk);
      }
    }
  }

  const saveNow = () =>
    writer.mutate(
      { path, content: value },
      {
        onSuccess: () => {
          // state first, then cache: the cache update re-renders with disk === value
          setBase(value);
          setSeenDisk(value);
          setConflict(false);
          qc.setQueryData(fileKey(spaceId, path), { path, content: value });
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
          {dirty && ' ●'}
        </span>
        <Button
          size="compact-sm"
          disabled={!dirty || writer.isPending}
          onClick={saveNow}
        >
          Save
        </Button>
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
      {conflict && (
        <Alert color="yellow" radius={0}>
          <Group>
            <span>File changed on disk</span>
            <Button
              size="compact-sm"
              variant="default"
              onClick={() => {
                setValue(disk);
                setBase(disk);
                setConflict(false);
              }}
            >
              Reload
            </Button>
            <Button
              size="compact-sm"
              variant="default"
              onClick={() => {
                setBase(disk);
                setConflict(false);
              }}
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
        value={value}
        onChange={(v) => setValue(v ?? '')}
        onMount={(editor, monaco) =>
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
            saveRef.current(),
          )
        }
        options={{ minimap: { enabled: false }, wordWrap: 'on' }}
      />
    </div>
  );
}
