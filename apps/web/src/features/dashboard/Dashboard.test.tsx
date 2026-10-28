import { FeaturesSchema } from '@pm/protocol';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';
import { AddWidgetMenu, Dashboard } from './Dashboard';
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

const wrap = (ui: React.ReactNode) =>
  render(<MantineProvider>{ui}</MantineProvider>);

const pressed = (label: string) =>
  (screen.getByLabelText(label) as unknown as { ariaPressed: string })
    .ariaPressed;

const items: Item[] = [
  { i: 'files', type: 'files', x: 0, y: 0, w: 2, h: 4, static: true },
  { i: 'chat', type: 'chat', x: 2, y: 0, w: 4, h: 4 },
];

describe('Dashboard', () => {
  it('renders widgets and titles, pin state, and calls back', () => {
    const cb = {
      onRemove: vi.fn(),
      onDuplicate: vi.fn(),
      onTogglePin: vi.fn(),
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
    expect(pressed('Unpin Files')).toBe('true');
    expect(pressed('Pin Agent chat')).toBe('false');
    expect(screen.getByLabelText('Remove Files')).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.click(screen.getByLabelText('Remove Agent chat'));
    expect(cb.onRemove).toHaveBeenCalledWith('chat');
    fireEvent.click(screen.getByLabelText('Pin Agent chat'));
    expect(cb.onTogglePin).toHaveBeenCalledWith('chat');
    const title = screen.getByText('Agent chat');
    fireEvent.pointerDown(title, { clientX: 5, clientY: 5 });
    fireEvent.pointerUp(title, { clientX: 5, clientY: 5 }); // first tap only focuses
    expect(cb.onToggleCollapse).not.toHaveBeenCalled();
    fireEvent.pointerDown(title, { clientX: 5, clientY: 5 });
    fireEvent.pointerUp(title, { clientX: 5, clientY: 5 }); // a tap on the focused header collapses
    expect(cb.onToggleCollapse).toHaveBeenCalledWith('chat');
    expect(cb.onTogglePin).toHaveBeenCalledTimes(1); // a button click does not
    fireEvent.click(screen.getByLabelText('Duplicate Files'));
    expect(cb.onDuplicate).toHaveBeenCalledWith('files');
    // titles carry the instance number
    fireEvent.click(screen.getByLabelText('Duplicate Agent chat 2'));
    expect(cb.onDuplicate).toHaveBeenCalledWith('chat-2');
  });
});

describe('useDashboard.setLayout', () => {
  it('keeps static and file, and does not change state for an unchanged layout', () => {
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
          static: undefined,
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
          onTogglePin={() => undefined}
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
    // body p -> .body div -> widget section
    type El = { parentElement: El; style: { zIndex: string } };
    const el = screen.getByText('body chat') as unknown as El;
    expect(el.parentElement.parentElement.style.zIndex).toBe('2');
    expect({ ...renders }).toEqual({ files: 1, chat: 1 });
  });
});
