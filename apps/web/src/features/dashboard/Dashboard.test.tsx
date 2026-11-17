import { FeaturesSchema } from '@pm/protocol';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useEffect, useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';
import {
  AddWidgetMenu,
  Dashboard,
  WidgetsMenu,
  revealWidget,
} from './Dashboard';
import { useDashboard, type Item } from './layout';

vi.mock('react-grid-layout', async (orig) => ({
  ...(await orig<typeof import('react-grid-layout')>()),
  useContainerWidth: () => ({
    width: 1200,
    mounted: true,
    containerRef: { current: null },
    measureWidth: () => undefined,
  }),
}));

// the spec tsconfig has no DOM lib: the few DOM bits these tests touch
type DomNode = {
  appendChild(node: DomNode): void;
  contains(node: unknown): boolean;
  style: { zIndex: string };
};
const dom = globalThis as unknown as {
  document: { querySelector(selector: string): DomNode | null };
  HTMLElement: {
    prototype: { moveBefore?: (node: DomNode, child: null) => void };
  };
};

const wrap = (ui: React.ReactNode) =>
  render(<MantineProvider>{ui}</MantineProvider>);

const items: Item[] = [
  { i: 'files', type: 'files', x: 0, y: 0, w: 2, h: 4 },
  { i: 'chat', type: 'chat', x: 2, y: 0, w: 4, h: 4 },
];

describe('Dashboard', () => {
  it('renders widgets and titles, has no pin button, and calls back', () => {
    const cb = {
      onRemove: vi.fn(),
      onDuplicate: vi.fn(),
      onToggleCollapse: vi.fn(),
    };
    wrap(
      <Dashboard
        items={[
          ...items,
          { i: 'chat-2', type: 'chat', x: 0, y: 4, w: 4, h: 4 },
        ]}
        render={(it) => <p>content {it.i}</p>}
        onLayout={() => undefined}
        {...cb}
      />,
    );
    expect(screen.getByText('content files')).toBeTruthy();
    expect(screen.getByText('content chat')).toBeTruthy();
    expect(screen.queryByLabelText(/Pin /)).toBeNull();
    expect(screen.queryByLabelText(/Unpin /)).toBeNull();
    // pinning is off: every widget can be removed
    expect(screen.getByLabelText('Remove Files')).toHaveProperty(
      'disabled',
      false,
    );
    fireEvent.click(screen.getByLabelText('Remove Agent chat'));
    expect(cb.onRemove).toHaveBeenCalledWith('chat');
    const title = screen.getByText('Agent chat');
    fireEvent.pointerDown(title, { clientX: 5, clientY: 5 });
    fireEvent.pointerUp(title, { clientX: 5, clientY: 5 }); // first tap only focuses
    expect(cb.onToggleCollapse).not.toHaveBeenCalled();
    fireEvent.pointerDown(title, { clientX: 5, clientY: 5 });
    fireEvent.pointerUp(title, { clientX: 5, clientY: 5 }); // a tap on the focused header collapses
    expect(cb.onToggleCollapse).toHaveBeenCalledWith('chat');
    fireEvent.click(screen.getByLabelText('Duplicate Files'));
    expect(cb.onDuplicate).toHaveBeenCalledWith('files');
    // titles carry the instance number
    fireEvent.click(screen.getByLabelText('Duplicate Agent chat 2'));
    expect(cb.onDuplicate).toHaveBeenCalledWith('chat-2');
  });
});

describe('useDashboard.setLayout', () => {
  it('keeps the file, drops a stored pin, and does not change state for an unchanged layout', () => {
    localStorage.setItem(
      'pm.dashboard.s',
      JSON.stringify([
        { i: 'files', type: 'files', x: 0, y: 0, w: 2, h: 4, static: true },
        { i: 'editor', type: 'editor', x: 2, y: 0, w: 4, h: 4, file: 'a.md' },
      ]),
    );
    const { result } = renderHook(() => useDashboard('s'));
    const before = result.current.items;
    act(() => result.current.setLayout(before));
    expect(result.current.items).toBe(before);
    act(() =>
      result.current.setLayout(
        before.map((it) => ({
          ...it,
          x: 1,
          file: undefined,
        })),
      ),
    );
    expect(result.current.items).toEqual([
      { ...before[0], x: 1 },
      { ...before[1], x: 1 },
    ]);
  });
});

describe('useDashboard.setLayout with hidden items', () => {
  it('keeps items that are missing from the grid', () => {
    localStorage.setItem(
      'pm.dashboard.h',
      JSON.stringify([
        { i: 'files', type: 'files', x: 0, y: 0, w: 2, h: 4 },
        { i: 'chat', type: 'chat', x: 2, y: 0, w: 4, h: 4 },
      ]),
    );
    const { result } = renderHook(() => useDashboard('h'));
    const [files, chat] = result.current.items;
    act(() => result.current.setLayout([{ ...files, x: 5 }]));
    expect(result.current.items).toEqual([{ ...files, x: 5 }, chat]);
  });
});

describe('AddWidgetMenu', () => {
  it('lists every type, also ones already present', async () => {
    const onAdd = vi.fn();
    wrap(<AddWidgetMenu onAdd={onAdd} onReset={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Add widget'));
    fireEvent.click(await screen.findByText('Agent chat'));
    expect(onAdd).toHaveBeenCalledWith('chat');
    expect(screen.queryByText('Files')).toBeTruthy();
  });

  it('hides Git unless the git feature is on', async () => {
    const f = FeaturesSchema.parse({});
    const { unmount } = render(
      <MantineProvider>
        <AddWidgetMenu
          features={f}
          onAdd={() => undefined}
          onReset={() => undefined}
        />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByLabelText('Add widget'));
    await screen.findByText('Agent chat');
    expect(screen.queryByText('Git')).toBeNull();
    unmount();
    wrap(
      <AddWidgetMenu
        features={{ ...f, git: true }}
        onAdd={() => undefined}
        onReset={() => undefined}
      />,
    );
    fireEvent.click(screen.getByLabelText('Add widget'));
    expect(await screen.findByText('Git')).toBeTruthy();
  });

  it('hides Experiments unless masterLoop is on', async () => {
    const f = FeaturesSchema.parse({});
    const { unmount } = render(
      <MantineProvider>
        <AddWidgetMenu
          features={f}
          onAdd={() => undefined}
          onReset={() => undefined}
        />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByLabelText('Add widget'));
    await screen.findByText('Agent chat');
    expect(screen.queryByText('Experiments')).toBeNull();
    unmount();
    wrap(
      <AddWidgetMenu
        features={{ ...f, masterLoop: true }}
        onAdd={() => undefined}
        onReset={() => undefined}
      />,
    );
    fireEvent.click(screen.getByLabelText('Add widget'));
    expect(await screen.findByText('Experiments')).toBeTruthy();
  });
});

describe('Dashboard raise', () => {
  it('does not re-render the other widgets bodies on pointerdown', () => {
    const renders: Record<string, number> = { files: 0, chat: 0 };
    const body = (it: Item) => {
      renders[it.i]++;
      return <p>body {it.i}</p>;
    };
    const Host = () => {
      const dash = useDashboard('raise-test');
      return (
        <Dashboard
          items={dash.items}
          render={body}
          onLayout={() => undefined}
          onRemove={() => undefined}
          onDuplicate={() => undefined}
          onToggleCollapse={() => undefined}
          onRaise={dash.raise}
        />
      );
    };
    localStorage.setItem(
      'pm.dashboard.raise-test',
      JSON.stringify([
        { i: 'files', type: 'files', x: 0, y: 0, w: 2, h: 4, z: 2 },
        { i: 'chat', type: 'chat', x: 2, y: 0, w: 4, h: 4, z: 1 },
      ]),
    );
    wrap(<Host />);
    expect({ ...renders }).toEqual({ files: 1, chat: 1 });
    // chat is below files: raising it re-renders the Dashboard, but no body
    fireEvent.pointerDown(screen.getByText('body chat'));
    expect(
      dom.document.querySelector('[data-widget="chat"]')?.style.zIndex,
    ).toBe('2');
    expect({ ...renders }).toEqual({ files: 1, chat: 1 });
  });
});

describe('Dashboard widget crash', () => {
  it('shows a fallback for the crashed widget only, and reloads it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let broken = true;
    const body = (it: Item) => {
      if (it.i === 'files' && broken) throw new Error('kaput');
      return <p>body {it.i}</p>;
    };
    wrap(
      <Dashboard
        items={items}
        render={body}
        onLayout={() => undefined}
        onRemove={() => undefined}
        onDuplicate={() => undefined}
        onToggleCollapse={() => undefined}
      />,
    );
    expect(screen.getByText('This widget crashed: kaput')).toBeTruthy();
    expect(screen.getByText('body chat')).toBeTruthy();
    broken = false;
    fireEvent.click(screen.getByText('Reload widget'));
    expect(screen.getByText('body files')).toBeTruthy();
    expect(screen.queryByText(/crashed/)).toBeNull();
    vi.restoreAllMocks();
  });
});

describe('Dashboard maximize', () => {
  it('shows the widget once, in a modal, and restores on close', async () => {
    const live = vi.fn();
    const body = (it: Item) => {
      live(it.i);
      return <p>body {it.i}</p>;
    };
    wrap(
      <Dashboard
        items={items}
        render={body}
        onLayout={() => undefined}
        onRemove={() => undefined}
        onDuplicate={() => undefined}
        onToggleCollapse={() => undefined}
      />,
    );
    expect(screen.getAllByText('body chat')).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('Maximize Agent chat'));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getAllByText('body chat')).toHaveLength(1); // never two live copies
    expect(screen.getByText('Shown maximized')).toBeTruthy();
    expect(screen.getByText('body files')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close maximized widget'));
    await waitFor(() =>
      expect(screen.queryByText('Shown maximized')).toBeNull(),
    );
    expect(screen.getAllByText('body chat')).toHaveLength(1);
  });

  it('keeps widget state across maximize and restore (no remount), moving its node', async () => {
    const mounts = vi.fn();
    function Counter() {
      const [n, setN] = useState(0);
      useEffect(() => mounts(), []);
      return (
        <button type="button" onClick={() => setN((v) => v + 1)}>
          count {n}
        </button>
      );
    }
    const proto = dom.HTMLElement.prototype;
    const move = vi.fn(function (this: DomNode, node: DomNode) {
      this.appendChild(node);
    });
    proto.moveBefore = move;
    try {
      wrap(
        <Dashboard
          items={items}
          render={(it) => (it.i === 'chat' ? <Counter /> : <p>body {it.i}</p>)}
          onLayout={() => undefined}
          onRemove={() => undefined}
          onDuplicate={() => undefined}
          onToggleCollapse={() => undefined}
        />,
      );
      fireEvent.click(screen.getByText('count 0'));
      fireEvent.click(screen.getByLabelText('Maximize Agent chat'));
      const dialog = await screen.findByRole('dialog');
      await waitFor(() =>
        expect(within(dialog).getByText('count 1')).toBeTruthy(),
      );
      fireEvent.click(within(dialog).getByText('count 1'));
      expect(within(dialog).getByText('count 2')).toBeTruthy();
      expect(move).toHaveBeenCalled(); // both nodes in the document: moved, not re-inserted
      fireEvent.click(screen.getByLabelText('Close maximized widget'));
      await waitFor(() =>
        expect(screen.queryByText('Shown maximized')).toBeNull(),
      );
      const tile = dom.document.querySelector('[data-widget="chat"]');
      expect(tile?.contains(screen.getByText('count 2'))).toBe(true);
      expect(mounts).toHaveBeenCalledTimes(1);
    } finally {
      delete proto.moveBefore;
    }
  });

  it('closes on Escape', async () => {
    wrap(
      <Dashboard
        items={items}
        render={(it) => <p>body {it.i}</p>}
        onLayout={() => undefined}
        onRemove={() => undefined}
        onDuplicate={() => undefined}
        onToggleCollapse={() => undefined}
      />,
    );
    fireEvent.click(screen.getByLabelText('Maximize Files'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByText('Shown maximized')).toBeNull(),
    );
  });
});

describe('WidgetsMenu', () => {
  const list: Item[] = [
    { i: 'files', type: 'files', x: 0, y: 0, w: 2, h: 4 },
    { i: 'editor', type: 'editor', x: 2, y: 0, w: 4, h: 4, file: 'src/a.md' },
    { i: 'editor-2', type: 'editor', x: 0, y: 4, w: 4, h: 1, prevH: 4 },
  ];
  it('lists open widgets by title and picks one', async () => {
    const onPick = vi.fn();
    wrap(<WidgetsMenu items={list} onPick={onPick} />);
    fireEvent.click(screen.getByLabelText('Open widgets'));
    expect(await screen.findByText(/Editor · a\.md/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Editor 2/));
    expect(onPick).toHaveBeenCalledWith(list[2]);
  });

  it('raises, expands and reveals a picked widget through the dashboard hook', async () => {
    localStorage.setItem('pm.dashboard.menu', JSON.stringify(list));
    const scrollIntoView = vi.fn();
    Object.assign(
      (globalThis as unknown as { Element: { prototype: object } }).Element
        .prototype,
      { scrollIntoView },
    );
    const Host = () => {
      const dash = useDashboard('menu');
      return (
        <>
          <WidgetsMenu
            items={dash.items}
            onPick={(it) => {
              dash.raise(it.i);
              if (it.prevH !== undefined) dash.toggleCollapsed(it.i);
              revealWidget(it.i);
            }}
          />
          <Dashboard
            items={dash.items}
            render={(it) => <p>body {it.i}</p>}
            onLayout={() => undefined}
            onRemove={() => undefined}
            onDuplicate={() => undefined}
            onToggleCollapse={dash.toggleCollapsed}
          />
          <output data-testid="s">
            {JSON.stringify(dash.items.find((x) => x.i === 'editor-2'))}
          </output>
        </>
      );
    };
    wrap(<Host />);
    fireEvent.click(screen.getByLabelText('Open widgets'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Editor 2/ }));
    const out = screen.getByTestId('s');
    expect(out).toHaveProperty('textContent');
    const st = JSON.parse(
      String((out as unknown as { textContent: string }).textContent),
    );
    expect(st.prevH).toBeUndefined();
    expect(st.h).toBe(4);
    expect(st.z).toBeGreaterThan(0);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });
});
