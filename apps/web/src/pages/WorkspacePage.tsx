import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Anchor, Group, Text } from '@mantine/core';
import { Link, useParams } from 'react-router';
import { ChatProvider, useChatContext } from '../features/chat/ChatContext';
import { ChatPanel } from '../features/chat/ChatPanel';
import { FileEditor } from '../features/files/FileEditor';
import { FileTree } from '../features/files/FileTree';
import { NewFileDialog } from '../features/files/NewFileDialog';
import { EvalsTab } from '../features/evals/EvalsTab';
import { copyPrefs } from '../features/evals/prefs';
import { AddWidgetMenu, Dashboard } from '../features/dashboard/Dashboard';
import {
  pickEditor,
  useDashboard,
  type Item,
} from '../features/dashboard/layout';
import { OpenTraceFile } from '../features/runs/OpenTraceFile';
import { SoundMenu } from '../features/sound/SoundMenu';
import { FeaturesMenu } from '../features/featureflags/FeaturesMenu';
import { useFeatures } from '../features/featureflags/hooks';
import { GraphWidget } from '../features/graph/GraphWidget';
import { VersionsWidget } from '../features/versions/VersionsWidget';
import { GitWidget } from '../features/git/GitWidget';
import { ExperimentsWidget } from '../features/experiments/ExperimentsWidget';
import { HooksWidget } from '../features/hooks/HooksWidget';
import { SkillsWidget } from '../features/skills/SkillsWidget';
import { RunsWidget } from '../features/runs/RunsList';
import { PlanPanel } from '../features/plans/PlanPanel';
import { useSpaces } from '../features/spaces/hooks';
import { ColorSchemeToggle } from '../features/theme/ColorSchemeToggle';
import { useWorkspaceWatch } from './useWorkspaceWatch';
import styles from './workspace.module.scss';

export function WorkspacePage() {
  const { id = '' } = useParams();
  return <Workspace key={id} id={id} />; // per-space state (expanded dirs, active editor, dialogs) resets on switch
}

const noDirs: ReadonlySet<string> = new Set();

function PlanWidget({ spaceId }: { spaceId: string }) {
  const chat = useChatContext();
  return <PlanPanel spaceId={spaceId} stats={chat.stats} onAsk={chat.send} />;
}

function Workspace({ id }: { id: string }) {
  const { data: spaces } = useSpaces();
  const space = spaces?.find((s) => s.id === id);
  const [creating, setCreating] = useState(false);
  // expanded dirs per files instance; the watch covers the union of all of them
  const [expandedBy, setExpandedBy] = useState<
    Readonly<Record<string, ReadonlySet<string>>>
  >({});
  const [activeEditor, setActiveEditor] = useState<string | null>(null);
  // paths watched on behalf of skills widgets, by instance
  const [skillPaths, setSkillPaths] = useState<
    Readonly<Record<string, string>>
  >({});
  const dash = useDashboard(id);
  const { data: features } = useFeatures(id);
  const evalsShown = dash.items.some((it) => it.type === 'evals');
  const editor = pickEditor(dash.items, activeEditor);
  useWorkspaceWatch(
    id,
    dash.items.flatMap((it) =>
      it.type === 'editor' && it.file
        ? [it.file]
        : it.type === 'files'
          ? [...(expandedBy[it.i] ?? [])]
          : it.type === 'skills' || it.type === 'graph'
            ? (JSON.parse(skillPaths[it.i] ?? '[]') as string[])
            : [],
    ),
    evalsShown,
  );

  // handlers read the latest values through a ref so `render` below stays stable across raises
  const live = useRef({
    select: (_path: string): void => undefined,
    toggle: (_i: string, _dir: string): void => undefined,
  });
  const select = useCallback((path: string) => live.current.select(path), []);
  const onToggle = useCallback(
    (i: string, d: string) => live.current.toggle(i, d),
    [],
  );

  const toggle = (instance: string, dir: string) =>
    setExpandedBy((prev) => {
      const next = new Set(prev[instance]);
      if (!next.delete(dir)) next.add(dir);
      return { ...prev, [instance]: next };
    });

  // a file opened from a files widget, the evals tab or a dialog goes to the active editor
  live.current.select = (path: string) => {
    if (editor) {
      dash.setFile(editor.i, path);
      setActiveEditor(editor.i);
    } else dash.add('editor', path);
  };

  live.current.toggle = toggle;

  const selectedFile = editor?.file ?? null;
  const spacePath = space?.path;
  const render = useMemo(
    () =>
      (it: Item): ReactNode => {
        switch (it.type) {
          case 'files':
            return (
              <FileTree
                spaceId={id}
                selected={selectedFile}
                onSelect={select}
                expanded={expandedBy[it.i] ?? noDirs}
                onToggle={(dir) => onToggle(it.i, dir)}
                onNew={() => setCreating(true)}
              />
            );
          case 'editor':
            return it.file ? (
              <FileEditor spaceId={id} path={it.file} />
            ) : (
              <Text p="md" c="dimmed">
                Select a file
              </Text>
            );
          case 'evals':
            return (
              <EvalsTab
                spaceId={id}
                widgetId={it.i}
                spaceRoot={spacePath}
                onOpenFile={select}
              />
            );
          case 'chat':
            return <ChatPanel spaceId={id} />;
          case 'plan':
            return <PlanWidget spaceId={id} />;
          case 'runs':
            return <RunsWidget spaceId={id} />;
          case 'hooks':
            return <HooksWidget spaceId={id} />;
          case 'git':
            return <GitWidget spaceId={id} />;
          case 'versions':
            return <VersionsWidget spaceId={id} />;
          case 'experiments':
            return <ExperimentsWidget spaceId={id} />;
          case 'graph':
            return (
              <GraphWidget
                spaceId={id}
                onOpenFile={select}
                onWatch={(paths) => {
                  const v = JSON.stringify(paths);
                  setSkillPaths((prev) =>
                    prev[it.i] === v ? prev : { ...prev, [it.i]: v },
                  );
                }}
              />
            );
          case 'skills':
            return (
              <SkillsWidget
                spaceId={id}
                onWatch={(paths) => {
                  const v = JSON.stringify(paths);
                  setSkillPaths((prev) =>
                    prev[it.i] === v ? prev : { ...prev, [it.i]: v },
                  );
                }}
              />
            );
        }
      },
    [id, expandedBy, selectedFile, spacePath, select, onToggle],
  );

  return (
    <div className={styles.page}>
      <Group component="header" className={styles.header}>
        <Anchor component={Link} to="/">
          ← Back to list
        </Anchor>
        <Text fw={600} flex={1}>
          {space?.name ?? id}
        </Text>
        <OpenTraceFile />
        <SoundMenu />
        <FeaturesMenu spaceId={id} />
        <AddWidgetMenu
          features={features}
          onAdd={(type) => dash.add(type)}
          onReset={() => {
            dash.reset();
            setExpandedBy({});
          }}
        />
        <ColorSchemeToggle />
      </Group>
      <main className={styles.dashboard}>
        <ChatProvider spaceId={id}>
          <Dashboard
            items={dash.items}
            features={features}
            render={render}
            onLayout={dash.setLayout}
            onRemove={(i) => {
              dash.remove(i);
              setExpandedBy(({ [i]: _gone, ...rest }) => rest);
            }}
            onDuplicate={(i) => {
              const copy = dash.duplicate(i);
              if (copy) copyPrefs(id, i, copy);
              if (copy && expandedBy[i])
                setExpandedBy((prev) => ({ ...prev, [copy]: prev[i] }));
            }}
            onActivate={(it) => it.type === 'editor' && setActiveEditor(it.i)}
            onTogglePin={dash.togglePin}
            onToggleCollapse={dash.toggleCollapsed}
            onRaise={dash.raise}
          />
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
