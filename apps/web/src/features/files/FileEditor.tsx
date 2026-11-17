import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Text,
  Tooltip,
} from '@mantine/core';
import { useLatestCallback } from '../../shared/ui/useLatestCallback';
import { useMonacoTheme } from '../../shared/ui/useMonacoTheme';
import MonacoEditor, { type OnMount } from '@monaco-editor/react';
import { ApiError } from '../../api/http';
import { useDeleteFile, useFile, useSaveDraft } from './hooks';
import { usePlainEditor } from './useNativeEditor';
import { useDraft } from './useDraft';
import styles from './files.module.scss';
import { QueryError } from '../../shared/ui/QueryError';

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

type Props = {
  spaceId: string;
  path: string;
  /** called after the file was deleted, so the host can close it */
  onDeleted?: () => void;
};

export function FileEditor({ spaceId, path, onDeleted }: Props) {
  const { data, error } = useFile(spaceId, path);
  const [deleted, setDeleted] = useState<string | null>(null);
  if (deleted === path)
    return (
      <Text p="md" c="dimmed">
        {path} was deleted
      </Text>
    );
  // keep a loaded editor (and its unsaved edits) even if a refetch fails
  if (data)
    return (
      <Editor
        key={path}
        spaceId={spaceId}
        path={path}
        onDeleted={() => {
          setDeleted(path);
          onDeleted?.();
        }}
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
  onDeleted,
}: Props & { disk: string; gone: boolean }) {
  const [plain, setPlain] = usePlainEditor();
  const [confirming, setConfirming] = useState(false);
  const del = useDeleteFile(spaceId);
  const draft = useDraft(disk);
  // a file deleted on disk is saved by creating it again
  const saver = useSaveDraft(spaceId, path, draft, { create: gone });
  const [editing, setEditing] = useState(false);
  const theme = useMonacoTheme();

  const saveNow = () =>
    void saver.write(draft.value).then(
      () => setEditing(false),
      () => undefined, // shown through `saver.error`
    );
  // the Monaco command is registered once and must call the latest save
  const saveLatest = useLatestCallback(saveNow);
  // stable identities: a new options object on every keystroke makes the Monaco wrapper call updateOptions each time
  const options = useMemo(
    () => ({
      minimap: { enabled: false },
      wordWrap: 'on' as const,
      readOnly: !editing,
      // sets `readonly` on the input textarea, so focus does not open the touch keyboard
      domReadOnly: !editing,
    }),
    [editing],
  );
  const onMount: OnMount = useMemo(
    () => (editor, monaco) =>
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
        saveLatest(),
      ),
    [saveLatest],
  );

  return (
    <div className={styles.editor}>
      <Group
        className={styles.header}
        justify="space-between"
        wrap="nowrap"
        px="md"
        py={6}
      >
        <span className={styles.headerPath} title={path}>
          <bdi>
            {path}
            {draft.dirty && ' ●'}
          </bdi>
        </span>
        <Group gap="xs" wrap="nowrap">
          <Tooltip label={plain ? 'Switch to Monaco' : 'Switch to plain text'}>
            <Button
              size="compact-sm"
              variant="subtle"
              aria-label="Toggle plain text editor"
              onClick={() => setPlain(!plain)}
            >
              {plain ? 'Plain' : 'Monaco'}
            </Button>
          </Tooltip>
          <Tooltip label="Delete file">
            <ActionIcon
              variant="default"
              color="red"
              aria-label="Delete file"
              disabled={gone}
              onClick={() => setConfirming(true)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
              </svg>
            </ActionIcon>
          </Tooltip>
          {editing && draft.dirty ? (
            <Button
              size="compact-sm"
              disabled={saver.isPending}
              onClick={saveNow}
            >
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
      </Group>
      <Modal
        opened={confirming}
        onClose={() => setConfirming(false)}
        title="Delete file"
        centered
      >
        <Text>Delete {path}? This cannot be undone.</Text>
        {del.error && <QueryError error={del.error} />}
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={del.isPending}
            onClick={() =>
              del.mutate(path, {
                onSuccess: () => {
                  setConfirming(false);
                  onDeleted?.();
                },
              })
            }
          >
            Delete
          </Button>
        </Group>
      </Modal>
      {saver.error && (
        <Text c="red" px="md">
          {saver.error.message}
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
            <Button size="compact-sm" variant="default" onClick={draft.reload}>
              Reload
            </Button>
            <Button size="compact-sm" variant="default" onClick={draft.accept}>
              Keep my edits
            </Button>
          </Group>
        </Alert>
      )}
      {plain ? (
        editing ? (
          <textarea
            className={styles.plain}
            value={draft.value}
            onChange={(e) => draft.setValue(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                saveLatest();
              }
            }}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            aria-label={`Edit ${path}`}
          />
        ) : (
          <pre className={`${styles.plain} ${styles.readonly}`}>
            {draft.value}
          </pre>
        )
      ) : (
        <MonacoEditor
          path={path}
          theme={theme}
          language={languageOf(path)}
          value={draft.value}
          onChange={(v) => draft.setValue(v ?? '')}
          onMount={onMount}
          options={options}
        />
      )}
    </div>
  );
}
