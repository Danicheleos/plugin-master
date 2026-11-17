import { FeaturesSchema } from '@pm/protocol';
import { describe, expect, it } from 'vitest';
import {
  addItem,
  breakpointFor,
  clampRect,
  deriveRect,
  layoutFor,
  parseBpLayouts,
  storeLayout,
  DEFAULT_ITEMS,
  duplicateItem,
  parseItems,
  pickEditor,
  raiseItem,
  toggleCollapsed,
  widgetEnabled,
  type Item,
} from './layout';

describe('parseItems', () => {
  it('uses the defaults without a stored value or with a broken one', () => {
    expect(parseItems(null)).toEqual(DEFAULT_ITEMS);
    expect(parseItems('{oops')).toEqual(DEFAULT_ITEMS);
    expect(parseItems('{"a":1}')).toEqual(DEFAULT_ITEMS);
  });

  it('drops unknown, duplicate and malformed items but keeps an empty dashboard', () => {
    const raw = JSON.stringify([
      { i: 'chat', type: 'chat', x: 1, y: 2, w: 3, h: 4, static: true },
      { i: 'chat', x: 0, y: 0, w: 1, h: 1 },
      { i: 'nope', x: 0, y: 0, w: 1, h: 1 },
      { i: 'plan', x: 'a', y: 0, w: 1, h: 1 },
    ]);
    // pinning is off: a stored pin is dropped
    expect(parseItems(raw)).toEqual([
      { i: 'chat', type: 'chat', x: 1, y: 2, w: 3, h: 4 },
    ]);
    expect(parseItems('[]')).toEqual([]);
  });

  it('keeps z and loads items without it', () => {
    const raw = JSON.stringify([
      { i: 'chat', type: 'chat', x: 0, y: 0, w: 1, h: 1, z: 3 },
      { i: 'plan', type: 'plan', x: 0, y: 0, w: 1, h: 1, z: 'x' },
    ]);
    expect(parseItems(raw).map((it) => it.z)).toEqual([3, undefined]);
  });

  it('migrates the old format (no type, id = type)', () => {
    const raw = JSON.stringify([{ i: 'editor', x: 0, y: 0, w: 2, h: 3 }]);
    expect(parseItems(raw)).toEqual([
      { i: 'editor', type: 'editor', x: 0, y: 0, w: 2, h: 3 },
    ]);
  });

  it('keeps instances and files, rejects an unknown type or a duplicate id', () => {
    const raw = JSON.stringify([
      { i: 'editor-2', type: 'editor', x: 0, y: 0, w: 1, h: 1, file: 'a.md' },
      { i: 'editor-2', type: 'editor', x: 0, y: 0, w: 1, h: 1 },
      { i: 'x-1', type: 'nope', x: 0, y: 0, w: 1, h: 1 },
    ]);
    expect(parseItems(raw)).toEqual([
      { i: 'editor-2', type: 'editor', x: 0, y: 0, w: 1, h: 1, file: 'a.md' },
    ]);
  });
});

const base: Item[] = [{ i: 'chat', type: 'chat', x: 0, y: 0, w: 4, h: 5 }];

describe('addItem', () => {
  it('adds a runs widget although it is not in the default layout', () => {
    expect(DEFAULT_ITEMS.some((d) => d.type === 'runs')).toBe(false);
    expect(addItem(base, 'runs')[1]).toMatchObject({
      i: 'runs',
      type: 'runs',
      x: 3,
      y: 0,
    });
    expect(
      parseItems(JSON.stringify([{ i: 'runs', x: 0, y: 0, w: 1, h: 1 }]))[0]
        .type,
    ).toBe('runs');
  });

  it('adds a hooks widget although it is not in the default layout', () => {
    expect(DEFAULT_ITEMS.some((d) => d.type === 'hooks')).toBe(false);
    expect(addItem(base, 'hooks')[1]).toMatchObject({
      i: 'hooks',
      type: 'hooks',
      x: 3,
      y: 0,
    });
    expect(
      parseItems(JSON.stringify([{ i: 'hooks', x: 0, y: 0, w: 1, h: 1 }]))[0]
        .type,
    ).toBe('hooks');
  });

  it('adds a skills widget although it is not in the default layout', () => {
    expect(DEFAULT_ITEMS.some((d) => d.type === 'skills')).toBe(false);
    expect(addItem(base, 'skills')[1]).toMatchObject({
      i: 'skills',
      type: 'skills',
      x: 3,
      y: 0,
    });
    expect(
      parseItems(JSON.stringify([{ i: 'skills', x: 0, y: 0, w: 1, h: 1 }]))[0]
        .type,
    ).toBe('skills');
  });

  it('puts a widget at the top, centered, over existing ones and above them', () => {
    const next = addItem(base, 'plan'); // plan is 4 x 7
    expect(next[1]).toMatchObject({
      i: 'plan',
      type: 'plan',
      x: 4,
      y: 0,
      w: 4,
      h: 7,
      z: 1,
    });
    const again = addItem(addItem(next, 'plan'), 'plan');
    expect(again.map((it) => it.i)).toEqual([
      'chat',
      'plan',
      'plan-2',
      'plan-3',
    ]);
    expect(again.slice(1).map((it) => [it.x, it.y, it.z])).toEqual([
      [4, 0, 1],
      [4, 0, 2],
      [4, 0, 3],
    ]);
  });

  it('centers by width and clamps to the grid', () => {
    for (const [w, x] of [
      [2, 5],
      [5, 3],
      [11, 0],
      [12, 0],
    ])
      expect(addItem([], 'files', { w })[0]).toMatchObject({ x, y: 0, w });
    expect(addItem([], 'files', { w: 20 })[0]).toMatchObject({
      x: 0,
      y: 0,
      w: 12,
    });
  });
});

describe('raiseItem', () => {
  const at = (i: string, z?: number): Item => ({
    i,
    type: 'files',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    ...(z === undefined ? {} : { z }),
  });

  it('puts the item above all others, also when z is absent', () => {
    expect(raiseItem([at('a'), at('b')], 'a').map((it) => it.z)).toEqual([
      1,
      undefined,
    ]);
    expect(raiseItem([at('a', 2), at('b', 5)], 'a').map((it) => it.z)).toEqual([
      2, 1,
    ]);
  });

  it('keeps z bounded by the item count however often items are raised', () => {
    let items: readonly Item[] = [at('a', 1), at('b', 2), at('c', 3)];
    for (let n = 0; n < 500; n++) items = raiseItem(items, 'abc'[n % 3]!);
    expect(Math.max(...items.map((it) => it.z ?? 0))).toBeLessThanOrEqual(3);
  });

  it('is a no-op (same array) when already on top or unknown', () => {
    const items = [at('a', 2), at('b', 5)];
    expect(raiseItem(items, 'b')).toBe(items);
    expect(raiseItem(items, 'zzz')).toBe(items);
  });
});

describe('duplicateItem', () => {
  const items: Item[] = [
    {
      i: 'editor',
      type: 'editor',
      x: 0,
      y: 0,
      w: 6,
      h: 7,
      file: 'a.md',
    },
  ];

  it('copies size and file with a unique id', () => {
    const next = duplicateItem(duplicateItem(items, 'editor'), 'editor');
    expect(next.map((it) => it.i)).toEqual(['editor', 'editor-2', 'editor-3']);
    expect(next[1]).toEqual({
      i: 'editor-2',
      type: 'editor',
      x: 3,
      y: 0,
      w: 6,
      h: 7,
      z: 1,
      file: 'a.md',
    });
    expect(next[2]).toMatchObject({ x: 3, y: 0, z: 2 });
  });

  it('ignores an unknown id and reuses a freed id', () => {
    expect(duplicateItem(items, 'zzz')).toEqual(items);
    const two = duplicateItem(items, 'editor');
    expect(duplicateItem([two[1]], 'editor-2')[1].i).toBe('editor');
  });
});

describe('pickEditor', () => {
  const items: Item[] = [
    { i: 'files', type: 'files', x: 0, y: 0, w: 1, h: 1 },
    { i: 'editor', type: 'editor', x: 0, y: 0, w: 1, h: 1 },
    { i: 'editor-2', type: 'editor', x: 0, y: 0, w: 1, h: 1 },
  ];

  it('prefers the active editor, falls back to the first, none without editors', () => {
    expect(pickEditor(items, 'editor-2')?.i).toBe('editor-2');
    expect(pickEditor(items, 'files')?.i).toBe('editor');
    expect(pickEditor(items, null)?.i).toBe('editor');
    expect(pickEditor(items.slice(0, 1), null)).toBeUndefined();
  });
});

describe('widgetEnabled', () => {
  it('shows types without a feature always', () => {
    expect(widgetEnabled('files')).toBe(true);
  });

  it('shows the git widget only when git is on', () => {
    const f = FeaturesSchema.parse({});
    expect(DEFAULT_ITEMS.some((d) => d.type === 'git')).toBe(false);
    expect(widgetEnabled('git')).toBe(false);
    expect(widgetEnabled('git', f)).toBe(false);
    expect(widgetEnabled('git', { ...f, git: true })).toBe(true);
  });

  it('shows the versions widget only when git is on, not by default', () => {
    const f = FeaturesSchema.parse({});
    expect(DEFAULT_ITEMS.some((d) => d.type === 'versions')).toBe(false);
    expect(widgetEnabled('versions', f)).toBe(false);
    expect(widgetEnabled('versions', { ...f, git: true })).toBe(true);
  });
});

describe('toggleCollapsed', () => {
  const w = { i: 'a', type: 'chat' as const, x: 0, y: 0, w: 4, h: 9 };
  it('collapses to the header and restores the height', () => {
    const c = toggleCollapsed([w], 'a');
    expect(c[0]).toMatchObject({ h: 1, prevH: 9 });
    expect(toggleCollapsed(c, 'a')[0]).toEqual(w);
  });
  it('survives a stored layout and is copied expanded', () => {
    const c = toggleCollapsed([w], 'a');
    expect(parseItems(JSON.stringify(c))[0]).toMatchObject({ h: 1, prevH: 9 });
    expect(duplicateItem(c, 'a')[1]).toMatchObject({ h: 9 });
  });
});

describe('responsive layouts', () => {
  it('picks the breakpoint by width', () => {
    expect(breakpointFor(1400)).toBe('lg');
    expect(breakpointFor(1000)).toBe('md');
    expect(breakpointFor(700)).toBe('sm');
  });

  it('derives scaled and clamped rects from lg', () => {
    expect(deriveRect({ x: 6, y: 3, w: 6, h: 5 }, 12)).toEqual({
      x: 6,
      y: 3,
      w: 6,
      h: 5,
    });
    expect(deriveRect({ x: 6, y: 3, w: 6, h: 5 }, 4)).toEqual({
      x: 2,
      y: 3,
      w: 2,
      h: 5,
    });
    expect(deriveRect({ x: 11, y: 0, w: 1, h: 2 }, 4)).toEqual({
      x: 2,
      y: 0,
      w: 2,
      h: 2,
    });
    expect(clampRect({ x: 7, y: 1, w: 9, h: 2 }, 8)).toEqual({
      x: 0,
      y: 1,
      w: 8,
      h: 2,
    });
  });

  const base: Item[] = [
    { i: 'a', type: 'chat', x: 0, y: 0, w: 6, h: 4 },
    { i: 'b', type: 'files', x: 6, y: 0, w: 6, h: 4 },
  ];
  it('uses lg as is, a stored rect when present, else derived', () => {
    expect(layoutFor(base, 'lg')).toEqual(base);
    const md = layoutFor(base, 'md');
    expect(md[0]).toMatchObject({ x: 0, w: 4 });
    expect(md[1]).toMatchObject({ x: 4, w: 4 });
    const own = layoutFor(base, 'sm', {
      sm: { a: { x: 0, y: 9, w: 4, h: 3 } },
    });
    expect(own[0]).toMatchObject({ y: 9, h: 3 });
    expect(own[1]).toMatchObject({ x: 2, w: 2 });
  });

  it('keeps a collapsed widget one row high', () => {
    const c = toggleCollapsed(base, 'a');
    expect(layoutFor(c, 'md')[0]).toMatchObject({ h: 1, prevH: 4 });
  });

  it('stores only what differs from the derived layout', () => {
    const shown = layoutFor(base, 'md');
    const same = storeLayout(base, {}, 'md', shown);
    expect(same).toEqual({});
    const moved = shown.map((it) => (it.i === 'a' ? { ...it, y: 7 } : it));
    const st = storeLayout(base, {}, 'md', moved);
    expect(st).toEqual({ md: { a: { x: 0, y: 7, w: 4, h: 4 } } });
    expect(storeLayout(base, st, 'md', layoutFor(base, 'md', st))).toBe(st);
    expect(layoutFor(base, 'lg')[0].y).toBe(0); // lg untouched
  });

  it('parses stored layouts defensively', () => {
    expect(parseBpLayouts(null)).toEqual({});
    expect(parseBpLayouts('{oops')).toEqual({});
    expect(parseBpLayouts('[1]')).toEqual({});
    expect(
      parseBpLayouts(
        JSON.stringify({
          md: {
            a: { x: 1, y: 2, w: 3, h: 4 },
            b: { x: 'q', y: 0, w: 1, h: 1 },
          },
          sm: 5,
          lg: { a: { x: 0, y: 0, w: 1, h: 1 } },
        }),
      ),
    ).toEqual({ md: { a: { x: 1, y: 2, w: 3, h: 4 } } });
  });

  it('loads an old stored list as the lg layout', () => {
    const old = JSON.stringify([
      { i: 'chat', type: 'chat', x: 1, y: 2, w: 3, h: 4, static: true },
    ]);
    expect(parseItems(old)[0]).toMatchObject({ x: 1 });
    expect(parseItems(old)[0]).not.toHaveProperty('static');
  });
});

describe('widget registry', () => {
  it('gives every widget type a title, a default size and the feature gate', async () => {
    const { WIDGETS, WIDGET_TYPES } = await import('./registry');
    expect(WIDGET_TYPES[0]).toBe('files');
    for (const t of WIDGET_TYPES) {
      expect(WIDGETS[t].title.length).toBeGreaterThan(0);
      expect(WIDGETS[t].defaultSize.w).toBeGreaterThan(0);
    }
    expect(WIDGETS.versions).toHaveProperty('feature', 'git');
    expect(WIDGETS.experiments).toHaveProperty('feature', 'masterLoop');
    expect(WIDGETS.chat).not.toHaveProperty('feature');
  });
});
