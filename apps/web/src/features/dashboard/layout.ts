import { useEffect, useRef, useState } from 'react';
import type { FeatureName, Features } from '@pm/protocol';

export const WIDGET_TYPES = [
  'files',
  'editor',
  'evals',
  'chat',
  'plan',
  'runs',
  'hooks',
  'skills',
  'git',
  'experiments',
  'versions',
  'graph',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

/** Widget types that need an optional feature. */
const WIDGET_FEATURE: Partial<Record<WidgetType, FeatureName>> = {
  git: 'git',
  versions: 'git',
  experiments: 'masterLoop',
};

/** False when the type's feature is off (or not loaded yet); such items stay persisted but are not shown. */
export const widgetEnabled = (type: WidgetType, features?: Features) => {
  const f = WIDGET_FEATURE[type];
  return !f || !!features?.[f];
};

/**
 * One widget instance. `i` is its unique id (`files`, `editor-2`, ...); `static` = pinned (cannot be
 * moved, resized or removed); `file` = the open file of an editor instance.
 */
export type Item = {
  i: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  static?: boolean;
  file?: string;
  /** Collapsed to its header (`h` is then `COLLAPSED_H`): the height to restore. */
  prevH?: number;
  /** Stacking order: a higher `z` is drawn above; absent = 0. */
  z?: number;
};

export const COLS = 12;
/** Rows of a collapsed widget: its header. */
export const COLLAPSED_H = 1;

export const DEFAULT_ITEMS: readonly Item[] = [
  { i: 'files', type: 'files', x: 0, y: 0, w: 2, h: 20 },
  { i: 'editor', type: 'editor', x: 2, y: 0, w: 6, h: 12 },
  { i: 'evals', type: 'evals', x: 2, y: 12, w: 6, h: 8 },
  { i: 'chat', type: 'chat', x: 8, y: 0, w: 4, h: 13 },
  { i: 'plan', type: 'plan', x: 8, y: 13, w: 4, h: 7 },
];

const defaults = (): Item[] => DEFAULT_ITEMS.map((d) => ({ ...d }));
const key = (spaceId: string) => `pm.dashboard.${spaceId}`;
const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Keeps only well-formed, known, non-duplicate items; a broken value falls back to the defaults. */
export function parseItems(raw: string | null): Item[] {
  if (raw === null) return defaults();
  try {
    const seen = new Set<string>();
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error('not a list');
    return list.flatMap((v: Partial<Item>) => {
      // the old format had no `type`: one widget per type, `i` was the type
      const type = v.type ?? v.i;
      if (
        typeof v.i !== 'string' ||
        !WIDGET_TYPES.includes(type as WidgetType) ||
        seen.has(v.i) ||
        !isNum(v.x) ||
        !isNum(v.y) ||
        !isNum(v.w) ||
        !isNum(v.h)
      )
        return [];
      seen.add(v.i);
      const { i, x, y, w, h } = v as Item;
      return [
        {
          i,
          type: type as WidgetType,
          x,
          y,
          w,
          h,
          ...(v.static ? { static: true } : {}),
          ...(typeof v.file === 'string' ? { file: v.file } : {}),
          ...(isNum(v.prevH) ? { prevH: v.prevH } : {}),
          ...(isNum(v.z) ? { z: v.z } : {}),
        },
      ];
    });
  } catch {
    return defaults();
  }
}

/** The first instance of a type keeps the bare id; later ones get `-2`, `-3`, ... */
function newId(items: readonly Item[], type: WidgetType): string {
  for (let n = 1; ; n++) {
    const i = n === 1 ? type : `${type}-${n}`;
    if (!items.some((it) => it.i === i)) return i;
  }
}

/** `2` for `editor-2`, `1` for the first instance. */
export const instanceNumber = (it: Item): number =>
  Number(it.i.slice(it.type.length + 1)) || 1;

const maxZ = (items: readonly Item[]) =>
  Math.max(0, ...items.map((it) => it.z ?? 0));

/** Places a new widget on top (z) at the top row, centered, overlapping what is there; size defaults to the type's. */
export function addItem(
  items: readonly Item[],
  type: WidgetType,
  { w, h, file }: { w?: number; h?: number; file?: string } = {},
): Item[] {
  const def = DEFAULT_ITEMS.find((d) => d.type === type) ?? { w: 6, h: 10 }; // runs is not in the default layout
  const size = { w: Math.min(w ?? def.w, COLS), h: h ?? def.h };
  return [
    ...items,
    {
      i: newId(items, type),
      type,
      ...size,
      x: Math.max(0, Math.floor((COLS - size.w) / 2)),
      y: 0,
      z: maxZ(items) + 1,
      ...(file ? { file } : {}),
    },
  ];
}

/** Copies a widget to the top center: same type, size and file, never pinned. */
export function duplicateItem(items: readonly Item[], i: string): Item[] {
  const src = items.find((it) => it.i === i);
  return src
    ? addItem(items, src.type, { ...src, h: src.prevH ?? src.h })
    : [...items];
}

/** Collapses a widget to its header, or restores the height it had. */
export function toggleCollapsed(items: readonly Item[], i: string): Item[] {
  return items.map((it) => {
    if (it.i !== i) return it;
    if (it.prevH === undefined) return { ...it, prevH: it.h, h: COLLAPSED_H };
    const { prevH, ...rest } = it;
    return { ...rest, h: prevH };
  });
}

/** Brings an item above all others; the same array when it is already on top. */
export function raiseItem(items: readonly Item[], i: string): readonly Item[] {
  const it = items.find((x) => x.i === i);
  if (!it) return items;
  const others = maxZ(items.filter((x) => x.i !== i));
  if (it.z !== undefined && it.z > others) return items;
  const raised = items.map((x) => (x.i === i ? { ...x, z: others + 1 } : x));
  // renumber by rank so z stays <= items.length (below Mantine's modal z-index 200)
  const zs = [
    ...new Set(raised.flatMap((x) => (x.z === undefined ? [] : [x.z]))),
  ].sort((a, b) => a - b);
  return raised.map((x) =>
    x.z === undefined ? x : { ...x, z: zs.indexOf(x.z) + 1 },
  );
}

/** The editor that receives a file opened elsewhere: the active one, else the first; none if no editor exists. */
export function pickEditor(
  items: readonly Item[],
  active: string | null,
): Item | undefined {
  const editors = items.filter((it) => it.type === 'editor');
  return editors.find((it) => it.i === active) ?? editors[0];
}

export function useDashboard(spaceId: string) {
  const [items, setItems] = useState(() =>
    parseItems(localStorage.getItem(key(spaceId))),
  );
  // debounced: a drag or raise must not serialize the whole layout synchronously each time
  const pending = useRef<() => void>(undefined);
  useEffect(() => {
    const save = () => {
      localStorage.setItem(key(spaceId), JSON.stringify(items));
      pending.current = undefined;
    };
    pending.current = save;
    const t = setTimeout(save, 400);
    return () => clearTimeout(t);
  }, [spaceId, items]);
  useEffect(() => {
    const flush = () => pending.current?.();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);
  return {
    items,
    /** Layout from the grid (drag/resize); keeps the pinned flag, which the grid does not own. */
    setLayout: (layout: readonly Item[]) =>
      setItems((prev) => {
        const next = prev.flatMap((old) => {
          const l = layout.find((it) => it.i === old.i);
          // items missing from the grid are hidden (feature off): kept as they are
          return [
            l
              ? {
                  ...old,
                  x: l.x,
                  y: l.y,
                  w: l.w,
                  h: old.prevH === undefined ? l.h : old.h,
                }
              : old,
          ];
        });
        // the grid reports on mount too; an unchanged layout must not re-render
        return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
      }),
    add: (type: WidgetType, file?: string) =>
      setItems((prev) => addItem(prev, type, { file })),
    /** Returns the id of the copy (undefined if `i` does not exist). */
    duplicate: (i: string) => {
      const next = duplicateItem(items, i);
      setItems(next);
      return next.length > items.length ? next[next.length - 1].i : undefined;
    },
    remove: (i: string) => setItems((prev) => prev.filter((it) => it.i !== i)),
    togglePin: (i: string) =>
      setItems((prev) =>
        prev.map((it) =>
          it.i === i ? { ...it, static: it.static ? undefined : true } : it,
        ),
      ),
    toggleCollapsed: (i: string) =>
      setItems((prev) => toggleCollapsed(prev, i)),
    setFile: (i: string, file: string) =>
      setItems((prev) => prev.map((it) => (it.i === i ? { ...it, file } : it))),
    raise: (i: string) => setItems((prev) => raiseItem(prev, i) as Item[]),
    reset: () => setItems(defaults()),
  };
}
