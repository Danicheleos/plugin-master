import { useCallback, type ComponentType } from 'react';
import { Text } from '@mantine/core';
import { ChatPanel, useChatActions, useChatStats } from '../features/chat';
import {
  WIDGETS,
  WIDGET_TYPES,
  type Item,
  type WidgetMeta,
  type WidgetType,
} from '../features/dashboard';
import { EvalsTab } from '../features/evals';
import { ExperimentsWidget } from '../features/experiments';
import { FileEditor, FileTree } from '../features/files';
import { GitWidget } from '../features/git';
import { GraphWidget } from '../features/graph';
import { HooksWidget } from '../features/hooks';
import { PlanPanel } from '../features/plans';
import { RunsWidget } from '../features/runs';
import { SkillsWidget } from '../features/skills';
import { useSpace } from '../features/spaces';
import { VersionsWidget } from '../features/versions';
import {
  useExpandedDirs,
  useSelectedFile,
  useWorkspaceApi,
} from './workspaceStore';

/** Props of every widget component: the space and the dashboard item (instance) it renders. */
export type WidgetProps = { spaceId: string; item: Item };

function FilesWidget({ spaceId, item }: WidgetProps) {
  const ws = useWorkspaceApi();
  const expanded = useExpandedDirs(item.i);
  const selected = useSelectedFile();
  return (
    <FileTree
      spaceId={spaceId}
      selected={selected}
      onSelect={ws.select}
      expanded={expanded}
      onToggle={(dir) => ws.toggleDir(item.i, dir)}
      onNew={ws.openNewFile}
    />
  );
}

function EditorWidget({ spaceId, item }: WidgetProps) {
  const ws = useWorkspaceApi();
  return item.file ? (
    <FileEditor
      spaceId={spaceId}
      path={item.file}
      onDeleted={() => ws.setFile(item.i, '')}
    />
  ) : (
    <Text p="md" c="dimmed">
      Select a file
    </Text>
  );
}

function EvalsWidget({ spaceId, item }: WidgetProps) {
  const ws = useWorkspaceApi();
  return (
    <EvalsTab
      spaceId={spaceId}
      widgetId={item.i}
      spaceRoot={useSpace(spaceId)?.path}
      onOpenFile={ws.select}
    />
  );
}

const ChatWidget = ({ spaceId }: WidgetProps) => (
  <ChatPanel spaceId={spaceId} />
);

function PlanWidget({ spaceId }: WidgetProps) {
  const stats = useChatStats();
  const { send } = useChatActions();
  return <PlanPanel spaceId={spaceId} stats={stats} onAsk={send} />;
}

/** The paths a widget wants the server to watch go to the workspace store as arrays. */
function useOnWatch(instance: string) {
  const ws = useWorkspaceApi();
  return useCallback(
    (paths: readonly string[]) => ws.setWatch(instance, paths),
    [ws, instance],
  );
}

function GraphWidgetHost({ spaceId, item }: WidgetProps) {
  const ws = useWorkspaceApi();
  return (
    <GraphWidget
      spaceId={spaceId}
      onOpenFile={ws.select}
      onWatch={useOnWatch(item.i)}
    />
  );
}

function SkillsWidgetHost({ spaceId, item }: WidgetProps) {
  return <SkillsWidget spaceId={spaceId} onWatch={useOnWatch(item.i)} />;
}

const COMPONENTS: { [T in WidgetType]: ComponentType<WidgetProps> } = {
  files: FilesWidget,
  editor: EditorWidget,
  evals: EvalsWidget,
  chat: ChatWidget,
  plan: PlanWidget,
  runs: ({ spaceId }) => <RunsWidget spaceId={spaceId} />,
  hooks: ({ spaceId }) => <HooksWidget spaceId={spaceId} />,
  skills: SkillsWidgetHost,
  git: ({ spaceId }) => <GitWidget spaceId={spaceId} />,
  experiments: ({ spaceId }) => <ExperimentsWidget spaceId={spaceId} />,
  versions: ({ spaceId }) => <VersionsWidget spaceId={spaceId} />,
  graph: GraphWidgetHost,
};

/**
 * The widget registry: per type its dashboard metadata (title, feature gate, default size, from
 * `features/dashboard/registry`) and the component that renders an instance. The titles, the add
 * menu, the feature gate, default sizes and rendering all go through it.
 */
export const WIDGET_REGISTRY: {
  [T in WidgetType]: WidgetMeta & { Component: ComponentType<WidgetProps> };
} = Object.fromEntries(
  WIDGET_TYPES.map((t) => [t, { ...WIDGETS[t], Component: COMPONENTS[t] }]),
) as never;

/** The body of a dashboard item. */
export const renderWidget = (spaceId: string, item: Item) => {
  const { Component } = WIDGET_REGISTRY[item.type];
  return <Component spaceId={spaceId} item={item} />;
};
