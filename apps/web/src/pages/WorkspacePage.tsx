import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { ActionIcon, Button, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Link, useParams } from 'react-router';
import { ChatProvider } from '../features/chat';
import { copyPrefs } from '../features/evals';
import { NewFileDialog } from '../features/files';
import {
  AddWidgetMenu,
  Dashboard,
  WidgetsMenu,
  pickEditor,
  revealWidget,
  useDashboard,
  type Item,
} from '../features/dashboard';
import { OpenTraceFile } from '../features/runs';
import { SettingsMenu } from '../features/settings';
import { FeaturesMenu, useFeatures } from '../features/featureflags';
import { useSpace } from '../features/spaces';
import { ErrorBoundary } from '../shared/ui/ErrorBoundary';
import { useWorkspaceWatch } from './useWorkspaceWatch';
import { renderWidget } from './widgets';
import {
  WorkspaceProvider,
  createWorkspaceStore,
  useWatchPaths,
  type WorkspaceApi,
} from './workspaceStore';
import styles from './workspace.module.scss';

/** House outline (no icon library in the app). */
const HouseIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 11l9-8 9 8" />
    <path d="M5 10v10h5v-6h4v6h5V10" />
  </svg>
);
export function WorkspacePage() {
  const { id = '' } = useParams();
  return <Workspace key={id} id={id} />; // per-space state (expanded dirs, active editor, dialogs) resets on switch
}

function Workspace({ id }: { id: string }) {
  const space = useSpace(id);
  const [creating, setCreating] = useState(false);
  const dash = useDashboard(id);
  const { items, layouts } = dash;
  const { setFile, add, raise, toggleCollapsed, remove, duplicate, reset } =
    dash;
  // expanded dirs, the active editor and watch paths: read by the widgets through selectors
  const [store] = useState(() => createWorkspaceStore(items));
  useLayoutEffect(() => store.setItems(items), [store, items]);
  // a widget picked in the header dropdown: scrolled into view once it has rendered raised/expanded
  const [reveal, setReveal] = useState<{ i: string; n: number } | null>(null);
  useEffect(() => {
    if (!reveal) return;
    const t = requestAnimationFrame(() => revealWidget(reveal.i));
    return () => cancelAnimationFrame(t);
  }, [reveal]);
  const { data: features } = useFeatures(id);
  const evalsShown = items.some((it) => it.type === 'evals');
  useWorkspaceWatch(id, useWatchPaths(store), evalsShown);

  // a file opened from a files widget, the evals tab or a dialog goes to the active editor
  const select = useCallback(
    (path: string) => {
      const { items: current, activeEditor } = store.getState();
      const editor = pickEditor(current, activeEditor);
      if (editor) {
        setFile(editor.i, path);
        store.setActiveEditor(editor.i);
      } else add('editor', path);
    },
    [store, setFile, add],
  );
  const api = useMemo<WorkspaceApi>(
    () => ({
      store,
      select,
      setFile,
      toggleDir: store.toggleDir,
      setWatch: store.setWatch,
      openNewFile: () => setCreating(true),
    }),
    [store, select, setFile],
  );
  // stable while the space is: widgets re-render only for their own item/file, not for workspace state
  const render = useCallback((it: Item) => renderWidget(id, it), [id]);

  return (
    <div className={styles.page}>
      <Group component="header" className={styles.header} gap="xs">
        <Tooltip label="Back to list">
          <ActionIcon
            component={Link}
            to="/"
            variant="subtle"
            color="gray"
            size="sm"
            aria-label="Back to list"
          >
            <HouseIcon />
          </ActionIcon>
        </Tooltip>
        <Text fw={600} size="sm" flex={1} truncate>
          {space?.name ?? id}
        </Text>
        <OpenTraceFile />
        <WidgetsMenu
          items={items}
          features={features}
          onPick={(it) => {
            raise(it.i);
            if (it.prevH !== undefined) toggleCollapsed(it.i);
            if (it.type === 'editor') store.setActiveEditor(it.i);
            setReveal((r) => ({ i: it.i, n: (r?.n ?? 0) + 1 }));
          }}
        />
        <AddWidgetMenu
          features={features}
          onAdd={(type) => add(type)}
          onReset={() => {
            reset();
            store.resetExpanded();
          }}
        />
        <FeaturesMenu spaceId={id} />
        <SettingsMenu />
      </Group>
      <main className={styles.dashboard}>
        <ChatProvider spaceId={id}>
          <ErrorBoundary
            fallback={({ error, reset: retry }) => (
              <Stack p="md" align="flex-start">
                <Text c="red">The dashboard crashed: {error.message}</Text>
                <Button variant="default" onClick={retry}>
                  Reload dashboard
                </Button>
              </Stack>
            )}
          >
            <WorkspaceProvider value={api}>
              <Dashboard
                items={items}
                features={features}
                render={render}
                onLayout={dash.setLayout}
                onRemove={(i) => {
                  remove(i);
                  store.removeInstance(i);
                }}
                onDuplicate={(i) => {
                  const copy = duplicate(i);
                  if (!copy) return;
                  copyPrefs(id, i, copy);
                  store.copyExpanded(i, copy);
                }}
                onActivate={(it) =>
                  it.type === 'editor' && store.setActiveEditor(it.i)
                }
                layouts={layouts}
                onToggleCollapse={toggleCollapsed}
                onRaise={raise}
              />
            </WorkspaceProvider>
          </ErrorBoundary>
        </ChatProvider>
      </main>
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
