import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import ReactGridLayout, {
  getCompactor,
  useContainerWidth,
} from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import type { Features } from '@pm/protocol';
import { ActionIcon, Button, Group, Menu, Modal, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { ErrorBoundary } from '../../shared/ui/ErrorBoundary';
import {
  BP_COLS,
  breakpointFor,
  instanceNumber,
  layoutFor,
  type BpLayouts,
  type Breakpoint,
  type Item,
} from './layout';
import {
  WIDGETS,
  WIDGET_TYPES,
  widgetEnabled,
  type WidgetType,
} from './registry';
import { WidgetHeader } from './WidgetHeader';
import styles from './dashboard.module.scss';

// free placement: no gravity towards the top, widgets may overlap (x is clamped to the columns, the dashboard scrolls vertically)
const freeCompactor = getCompactor(null, true);
// module constants: RGL's GridItem memo compares `margin` by identity
const gridConfigs = {
  lg: { cols: BP_COLS.lg, rowHeight: 40, margin: [8, 8] },
  md: { cols: BP_COLS.md, rowHeight: 40, margin: [8, 8] },
  sm: { cols: BP_COLS.sm, rowHeight: 40, margin: [8, 8] },
} as const;
const dragConfig = { handle: `.${styles.title}`, cancel: 'button' };

/** `Editor`, `Editor 2`, ... */
export const widgetTitle = (it: Item) => {
  const n = instanceNumber(it);
  return `${WIDGETS[it.type].title}${n > 1 ? ` ${n}` : ''}`;
};

/** Calls `render` inside the boundary, so a throwing widget is caught. */
function WidgetContent({
  item,
  render,
}: {
  item: Item;
  render: (item: Item) => ReactNode;
}) {
  return <>{render(item)}</>;
}

/** The widget body re-renders only when `render` or the item's identity/file changes, not on raise/move/resize. */
const WidgetBody = memo(
  function WidgetBody({
    item,
    render,
  }: {
    item: Item;
    render: (item: Item) => ReactNode;
  }) {
    return (
      <ErrorBoundary
        fallback={({ error, reset }) => (
          <Group p="xs" gap="xs" wrap="nowrap" role="alert">
            <Text size="sm" c="red" flex={1}>
              This widget crashed: {error.message}
            </Text>
            <Button size="compact-xs" variant="default" onClick={reset}>
              Reload widget
            </Button>
          </Group>
        )}
      >
        <WidgetContent item={item} render={render} />
      </ErrorBoundary>
    );
  },
  (a, b) =>
    a.render === b.render &&
    a.item.i === b.item.i &&
    a.item.type === b.item.type &&
    a.item.file === b.item.file,
);

/**
 * Puts `node` as the last child of `parent`, keeping its state where the browser can: `moveBefore`
 * keeps focus, scroll, iframes and animations; it needs both nodes in the document, else (and in
 * browsers without it) a plain append.
 */
function place(node: HTMLElement, parent: HTMLElement): void {
  if (node.parentNode === parent) return;
  const p = parent as HTMLElement & {
    moveBefore?: (node: Node, child: Node | null) => void;
  };
  if (p.moveBefore && node.isConnected && parent.isConnected) {
    try {
      p.moveBefore(node, null);
      return;
    } catch {
      // e.g. across documents: fall back to a plain append
    }
  }
  parent.appendChild(node);
}

/**
 * A widget body that is never remounted by maximizing: React renders it (through a portal) into an
 * own DOM node, and only that node moves between the tile and the maximize dialog. The React tree
 * stays inside the tile, so widget state survives; `moveBefore` also keeps DOM state (scroll, focus).
 */
function HostedBody({
  item,
  render,
  maximized,
  modalSlot,
}: {
  item: Item;
  render: (item: Item) => ReactNode;
  maximized: boolean;
  /** the dialog's body while this widget is maximized */
  modalSlot: HTMLElement | null;
}) {
  const [host] = useState(() => {
    const el = document.createElement('div');
    el.className = styles.host;
    return el;
  });
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const target = maximized ? modalSlot : slot.current;
    if (target) place(host, target);
  }, [host, maximized, modalSlot]);
  useLayoutEffect(() => () => host.remove(), [host]);
  return (
    <>
      {maximized && (
        <Text size="sm" c="dimmed" p="xs">
          Shown maximized
        </Text>
      )}
      <div ref={slot} className={styles.slot} hidden={maximized} />
      {createPortal(<WidgetBody item={item} render={render} />, host)}
    </>
  );
}

type Props = {
  items: readonly Item[];
  /** Widgets whose feature is off are not rendered. */
  features?: Features;
  render: (item: Item) => ReactNode;
  /** Stored md/sm layouts (lg = `items`); absent = all derived. */
  layouts?: BpLayouts;
  /** The grid reports a layout at a breakpoint (drag/resize, mount). */
  onLayout: (layout: readonly Item[], bp: Breakpoint) => void;
  onRemove: (i: string) => void;
  onDuplicate: (i: string) => void;
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
  layouts,
  onLayout,
  onRemove,
  onDuplicate,
  onToggleCollapse,
  onActivate,
  onRaise,
}: Props) {
  const { width, containerRef, mounted } = useContainerWidth();
  // the focused widget; a header tap collapses only a widget that was already focused (expanding always works)
  const focused = useRef<string | null>(null);
  const wasFocused = useRef(false);
  const items = useMemo(
    () => all.filter((it) => widgetEnabled(it.type, features)),
    [all, features],
  );
  const bp = breakpointFor(width);
  const view = useMemo(
    () => layoutFor(items, bp, layouts),
    [items, bp, layouts],
  );
  const gridLayout = useMemo(
    () => view.map(({ prevH: _, ...it }) => it),
    [view],
  );
  // the widget shown in the modal: its node moves there, the tile holds a placeholder (never two copies)
  const [maximized, setMaximized] = useState<string | null>(null);
  // the dialog's body element; the maximized widget's node is moved into it
  const [modalSlot, setModalSlot] = useState<HTMLDivElement | null>(null);
  const maxItem = items.find((it) => it.i === maximized);
  const small = useMediaQuery('(max-width: 48em)');
  return (
    <div ref={containerRef} className={styles.dashboard}>
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={gridLayout}
          gridConfig={gridConfigs[bp]}
          dragConfig={dragConfig}
          compactor={freeCompactor}
          onLayoutChange={(l) => onLayout(l as readonly Item[], bp)}
        >
          {items.map((it) => {
            const title = widgetTitle(it);
            return (
              <section
                key={it.i}
                data-widget={it.i}
                tabIndex={-1}
                className={styles.widget}
                style={it.z ? { zIndex: it.z } : undefined}
                onPointerDownCapture={() => {
                  wasFocused.current = focused.current === it.i;
                  focused.current = it.i;
                  onRaise?.(it.i);
                  onActivate?.(it);
                }}
                onFocusCapture={() => {
                  focused.current = it.i;
                  onActivate?.(it);
                }}
              >
                <WidgetHeader
                  item={it}
                  title={title}
                  wasFocused={wasFocused}
                  onMaximize={setMaximized}
                  onDuplicate={onDuplicate}
                  onRemove={onRemove}
                  onToggleCollapse={onToggleCollapse}
                />
                <div className={styles.body}>
                  <HostedBody
                    item={it}
                    render={render}
                    maximized={maximized === it.i}
                    modalSlot={maximized === it.i ? modalSlot : null}
                  />
                </div>
              </section>
            );
          })}
        </ReactGridLayout>
      )}
      <Modal
        opened={!!maxItem}
        onClose={() => setMaximized(null)}
        title={maxItem && widgetTitle(maxItem)}
        closeButtonProps={{ 'aria-label': 'Close maximized widget' }}
        fullScreen={!!small}
        size="95vw"
        classNames={{ content: styles.maxContent, body: styles.maxBody }}
      >
        {/* unconditional: the dialog keeps it mounted while closing, so the node can move back first */}
        <div ref={setModalSlot} className={styles.slot} />
      </Modal>
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
            {WIDGETS[t].title}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item onClick={onReset}>Reset layout</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/** Scrolls a widget's tile into view in the dashboard and focuses it; false if it is not shown. */
export function revealWidget(i: string): boolean {
  const el = Array.from(
    document.querySelectorAll<HTMLElement>('[data-widget]'),
  ).find((e) => e.dataset.widget === i);
  if (!el) return false;
  el.scrollIntoView({ block: 'nearest' });
  el.focus({ preventScroll: true });
  return true;
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Header dropdown listing the open widgets; picking one brings it to the front (see `onPick`). */
export function WidgetsMenu({
  items,
  features,
  onPick,
}: {
  items: readonly Item[];
  features?: Features;
  onPick: (item: Item) => void;
}) {
  return (
    <Menu position="bottom-end">
      <Menu.Target>
        <ActionIcon variant="default" aria-label="Open widgets">
          ▤
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Open widgets</Menu.Label>
        {items
          .filter((it) => widgetEnabled(it.type, features))
          .map((it) => (
            <Menu.Item key={it.i} onClick={() => onPick(it)}>
              {widgetTitle(it)}
              {it.type === 'editor' && it.file && ` · ${baseName(it.file)}`}
              {it.prevH !== undefined && ' (collapsed)'}
            </Menu.Item>
          ))}
      </Menu.Dropdown>
    </Menu>
  );
}
