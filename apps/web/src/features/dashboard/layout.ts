import { useEffect, useMemo, useRef, useState } from 'react';
import { storage } from '../../shared/storage';
import { useLatestCallback } from '../../shared/ui/useLatestCallback';
import {
  WIDGETS,
  WIDGET_TYPES,
  isWidgetType,
  widgetEnabled,
  type WidgetType,
} from './registry';

export { WIDGET_TYPES, widgetEnabled, type WidgetType };

/**
 * One widget instance. `i` is its unique id (`files`, `editor-2`, ...); `file` = the open file of an
 * editor instance. Pinning is off: a `static` flag in stored layouts is dropped when parsing.
 */
export type Item = {
  i: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  file?: string;
  /** Collapsed to its header (`h` is then `COLLAPSED_H`): the height to restore. */
  prevH?: number;
  /** Stacking order: a higher `z` is drawn above; absent = 0. */
  z?: number;
};

export const COLS = 12;

/** Responsive layouts: `lg` is the source of truth (the items' own x/y/w/h); `md` and `sm` are stored separately once the user edits them there. */
export type Breakpoint = 'lg' | 'md' | 'sm';
/** Min container width (px) of a breakpoint: iPad landscape lands in `md`, iPad portrait in `sm`. */
export const BREAKPOINTS: Record<Breakpoint, number> = {
  lg: 1280,
  md: 900,
  sm: 0,
};
export const BP_COLS: Record<Breakpoint, number> = { lg: COLS, md: 8, sm: 4 };
/** Narrowest a derived widget gets (columns), so a 4-column layout stays usable. */
const MIN_DERIVED_W = 2;

export const breakpointFor = (width: number): Breakpoint =>
  width >= BREAKPOINTS.lg ? 'lg' : width >= BREAKPOINTS.md ? 'md' : 'sm';

export type Rect = { x: number; y: number; w: number; h: number };
/** Stored non-lg layouts: breakpoint -> widget id -> rect. */
export type BpLayouts = Partial<Record<'md' | 'sm', Record<string, Rect>>>;
/** Rows of a collapsed widget: its header. */
export const COLLAPSED_H = 1;

const defaultItem = (type: WidgetType, x: number, y: number): Item => ({
  i: type,
  type,
  x,
  y,
  ...WIDGETS[type].defaultSize,
});

/** The initial layout; sizes come from the widget registry. */
export const DEFAULT_ITEMS: readonly Item[] = [
  defaultItem('files', 0, 0),
  defaultItem('editor', 2, 0),
  defaultItem('evals', 2, 12),
  defaultItem('chat', 8, 0),
  defaultItem('plan', 8, 13),
];

const defaults = (): Item[] => DEFAULT_ITEMS.map((d) => ({ ...d }));
const key = (spaceId: string) => `pm.dashboard.${spaceId}`;
/** md/sm layouts live beside the lg list, which keeps its old format. */
const layoutsKey = (spaceId: string) => `pm.dashboard.${spaceId}.layouts`;
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
        !isWidgetType(type) ||
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

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Fits a rect into `cols` columns (x/w clamped, h and y untouched). */
export function clampRect(r: Rect, cols: number): Rect {
  const w = clamp(Math.round(r.w), 1, cols);
  return { ...r, w, x: clamp(Math.round(r.x), 0, cols - w) };
}

/** A lg rect for a layout of `cols` columns: x and w scaled, then clamped; y and h kept. */
export function deriveRect(lg: Rect, cols: number): Rect {
  if (cols === COLS) return { x: lg.x, y: lg.y, w: lg.w, h: lg.h };
  const minW = Math.min(MIN_DERIVED_W, cols);
  const w = clamp(Math.round((lg.w * cols) / COLS), minW, cols);
  const x = clamp(Math.round((lg.x * cols) / COLS), 0, cols - w);
  return { x, y: lg.y, w, h: lg.h };
}

const sameRect = (a: Rect, b: Rect) =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * The items as laid out at a breakpoint: `lg` is `items` itself; others use the stored rect of a
 * widget, else one derived from its lg rect. A collapsed widget is always `COLLAPSED_H` high.
 */
export function layoutFor(
  items: readonly Item[],
  bp: Breakpoint,
  stored: BpLayouts = {},
): Item[] {
  if (bp === 'lg') return [...items];
  const cols = BP_COLS[bp];
  return items.map((it) => {
    const own = stored[bp]?.[it.i];
    const r = own
      ? clampRect(own, cols)
      : deriveRect({ ...it, h: it.prevH ?? it.h }, cols);
    return { ...it, ...r, h: it.prevH === undefined ? r.h : COLLAPSED_H };
  });
}

/**
 * Stores what the grid reports at a non-lg breakpoint; widgets whose rect equals what is shown
 * already (so still derived) are not stored, collapsed ones keep their stored height. The same
 * object when nothing changed. Ids not in `items` are dropped.
 */
export function storeLayout(
  items: readonly Item[],
  stored: BpLayouts,
  bp: 'md' | 'sm',
  layout: readonly (Rect & { i: string })[],
): BpLayouts {
  const shown = layoutFor(items, bp, stored);
  const next: Record<string, Rect> = {};
  for (const it of items) {
    const l = layout.find((x) => x.i === it.i);
    const cur = shown.find((x) => x.i === it.i);
    const prev = stored[bp]?.[it.i];
    if (!l || !cur) {
      if (prev) next[it.i] = prev; // hidden (feature off): kept
      continue;
    }
    if (!prev && sameRect(l, cur)) continue; // still the derived one
    const collapsed = it.prevH !== undefined;
    // a collapsed widget reports its header height: keep the expanded one
    const h = collapsed ? (prev?.h ?? it.prevH ?? it.h) : l.h;
    next[it.i] = { x: l.x, y: l.y, w: l.w, h };
  }
  const merged = { ...stored, [bp]: next };
  if (Object.keys(next).length === 0) delete merged[bp];
  return JSON.stringify(merged) === JSON.stringify(stored) ? stored : merged;
}

/** Keeps well-formed rects of the known breakpoints; anything else is dropped. */
export function parseBpLayouts(raw: string | null): BpLayouts {
  if (raw === null) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
    const out: BpLayouts = {};
    for (const bp of ['md', 'sm'] as const) {
      const m = (v as Record<string, unknown>)[bp];
      if (typeof m !== 'object' || m === null || Array.isArray(m)) continue;
      const rects: Record<string, Rect> = {};
      for (const [i, r] of Object.entries(m)) {
        const { x, y, w, h } = (r ?? {}) as Partial<Rect>;
        if (isNum(x) && isNum(y) && isNum(w) && isNum(h) && w > 0 && h > 0)
          rects[i] = { x, y, w, h };
      }
      if (Object.keys(rects).length) out[bp] = rects;
    }
    return out;
  } catch {
    return {};
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
  const def = WIDGETS[type].defaultSize;
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

/** Copies a widget to the top center: same type, size and file. */
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
    parseItems(storage.get(key(spaceId))),
  );
  const [layouts, setLayouts] = useState(() =>
    parseBpLayouts(storage.get(layoutsKey(spaceId))),
  );
  // debounced: a drag or raise must not serialize the whole layout synchronously each time
  const pending = useRef<() => void>(undefined);
  useEffect(() => {
    const save = () => {
      storage.set(key(spaceId), JSON.stringify(items));
      storage.set(layoutsKey(spaceId), JSON.stringify(layouts));
      pending.current = undefined;
    };
    pending.current = save;
    const t = setTimeout(save, 400);
    return () => clearTimeout(t);
  }, [spaceId, items, layouts]);
  useEffect(() => {
    const flush = () => pending.current?.();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);
  const setLayout = useLatestCallback(
    (layout: readonly Item[], bp: Breakpoint = 'lg') => {
      if (bp !== 'lg') {
        setLayouts((prev) => storeLayout(items, prev, bp, layout));
        return;
      }
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
      });
    },
  );
  /** Returns the id of the copy (undefined if `i` does not exist). */
  const duplicate = useLatestCallback((i: string) => {
    const next = duplicateItem(items, i);
    setItems(next);
    return next.length > items.length ? next[next.length - 1].i : undefined;
  });
  // the actions never change identity, so a consumer can list them as dependencies freely
  const actions = useMemo(
    () => ({
      /** Layout from the grid (drag/resize) at a breakpoint. */
      setLayout,
      add: (type: WidgetType, file?: string) =>
        setItems((prev) => addItem(prev, type, { file })),
      duplicate,
      remove: (i: string) =>
        setItems((prev) => prev.filter((it) => it.i !== i)),
      toggleCollapsed: (i: string) =>
        setItems((prev) => toggleCollapsed(prev, i)),
      setFile: (i: string, file: string) =>
        setItems((prev) =>
          prev.map((it) => (it.i === i ? { ...it, file } : it)),
        ),
      raise: (i: string) => setItems((prev) => raiseItem(prev, i) as Item[]),
      reset: () => {
        setItems(defaults());
        setLayouts({});
      },
    }),
    [setLayout, duplicate],
  );
  return {
    items,
    /** Stored md/sm layouts; see `layoutFor`. */
    layouts,
    ...actions,
  };
}
