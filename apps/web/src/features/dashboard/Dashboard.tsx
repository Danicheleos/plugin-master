import { memo, useRef, type ReactNode } from 'react';
import ReactGridLayout, {
  getCompactor,
  useContainerWidth,
} from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import type { Features } from '@pm/protocol';
import { ActionIcon, Group, Menu, Text, Tooltip } from '@mantine/core';
import {
  COLS,
  WIDGET_TYPES,
  instanceNumber,
  widgetEnabled,
  type Item,
  type WidgetType,
} from './layout';
import styles from './dashboard.module.scss';

// free placement: no gravity towards the top, widgets may overlap (x is clamped to the columns, the dashboard scrolls vertically)
const freeCompactor = getCompactor(null, true);
// module constants: RGL's GridItem memo compares `margin` by identity
const gridConfig = { cols: COLS, rowHeight: 40, margin: [8, 8] } as const;
const dragConfig = { handle: `.${styles.title}`, cancel: 'button' };

const WIDGET_TITLES: Record<WidgetType, string> = {
  files: 'Files',
  editor: 'Editor',
  evals: 'Evals',
  chat: 'Agent chat',
  plan: 'Current plan',
  runs: 'Runs',
  hooks: 'Hooks',
  skills: 'Skills',
  git: 'Git',
  experiments: 'Experiments',
  versions: 'Versions',
  graph: 'Structure graph',
};

/** `Editor`, `Editor 2`, ... */
const widgetTitle = (it: Item) => {
  const n = instanceNumber(it);
  return `${WIDGET_TITLES[it.type]}${n > 1 ? ` ${n}` : ''}`;
};

/** The widget body re-renders only when `render` or the item's identity/file changes, not on raise/move/resize. */
const WidgetBody = memo(
  function WidgetBody({
    item,
    render,
  }: {
    item: Item;
    render: (item: Item) => ReactNode;
  }) {
    return <>{render(item)}</>;
  },
  (a, b) =>
    a.render === b.render &&
    a.item.i === b.item.i &&
    a.item.type === b.item.type &&
    a.item.file === b.item.file,
);

type Props = {
  items: readonly Item[];
  /** Widgets whose feature is off are not rendered. */
  features?: Features;
  render: (item: Item) => ReactNode;
  onLayout: (layout: readonly Item[]) => void;
  onRemove: (i: string) => void;
  onDuplicate: (i: string) => void;
  onTogglePin: (i: string) => void;
  /** Click on a widget header: collapse to the header / restore. */
  onToggleCollapse: (i: string) => void;
  /** A widget was clicked or focused. */
  onActivate?: (item: Item) => void;
  /** Pointer-down inside a widget: bring it to the front. */
  onRaise?: (i: string) => void;
};

export function Dashboard({
  items: all,
  features,
  render,
  onLayout,
  onRemove,
  onDuplicate,
  onTogglePin,
  onToggleCollapse,
  onActivate,
  onRaise,
}: Props) {
  const { width, containerRef, mounted } = useContainerWidth();
  // pointer events, not click: on touch the drag handle swallows the synthesized click; a drag is not a tap
  const down = useRef<[number, number] | null>(null);
  const items = all.filter((it) => widgetEnabled(it.type, features));
  // RGL's `static` makes an item an obstacle that others (and other statics) are pushed away from;
  // a pin only locks move/resize here, so pinned widgets may overlap and grow freely
  const gridLayout = items.map(({ static: pinned, prevH: _, ...it }) => ({
    ...it,
    isDraggable: !pinned,
    isResizable: !pinned,
  }));
  return (
    <div ref={containerRef} className={styles.dashboard}>
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={gridLayout}
          gridConfig={gridConfig}
          dragConfig={dragConfig}
          compactor={freeCompactor}
          onLayoutChange={(l) => onLayout(l as readonly Item[])}
        >
          {items.map((it) => {
            const title = widgetTitle(it);
            return (
              <section
                key={it.i}
                className={styles.widget}
                style={it.z ? { zIndex: it.z } : undefined}
                onPointerDownCapture={() => {
                  onRaise?.(it.i);
                  onActivate?.(it);
                }}
                onFocusCapture={() => onActivate?.(it)}
              >
                <Group
                  className={styles.header}
                  gap={4}
                  wrap="nowrap"
                  data-collapsed={it.prevH !== undefined || undefined}
                  onPointerDown={(e) => (down.current = [e.clientX, e.clientY])}
                  onPointerUp={(e) => {
                    const start = down.current;
                    down.current = null;
                    if (!start || (e.target as HTMLElement).closest('button'))
                      return;
                    if (
                      Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 4
                    )
                      return;
                    onToggleCollapse(it.i);
                  }}
                >
                  <Text
                    className={styles.title}
                    data-pinned={it.static || undefined}
                    fw={600}
                    size="sm"
                    flex={1}
                  >
                    {title}
                  </Text>
                  <Tooltip label={it.static ? 'Unpin' : 'Pin in place'}>
                    <ActionIcon
                      variant={it.static ? 'light' : 'subtle'}
                      size="sm"
                      aria-label={`${it.static ? 'Unpin' : 'Pin'} ${title}`}
                      aria-pressed={!!it.static}
                      onClick={() => onTogglePin(it.i)}
                    >
                      📌
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Duplicate">
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      aria-label={`Duplicate ${title}`}
                      onClick={() => onDuplicate(it.i)}
                    >
                      ⧉
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={it.static ? 'Unpin to remove' : 'Remove'}>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      aria-label={`Remove ${title}`}
                      disabled={it.static}
                      onClick={() => onRemove(it.i)}
                    >
                      ✕
                    </ActionIcon>
                  </Tooltip>
                </Group>
                <div className={styles.body}>
                  <WidgetBody item={it} render={render} />
                </div>
              </section>
            );
          })}
        </ReactGridLayout>
      )}
    </div>
  );
}

export function AddWidgetMenu({
  features,
  onAdd,
  onReset,
}: {
  features?: Features;
  onAdd: (type: WidgetType) => void;
  onReset: () => void;
}) {
  return (
    <Menu position="bottom-end">
      <Menu.Target>
        <ActionIcon variant="default" aria-label="Add widget">
          +
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Add widget</Menu.Label>
        {WIDGET_TYPES.filter((t) => widgetEnabled(t, features)).map((t) => (
          <Menu.Item key={t} onClick={() => onAdd(t)}>
            {WIDGET_TITLES[t]}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item onClick={onReset}>Reset layout</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
