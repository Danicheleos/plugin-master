import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePage } from './WorkspacePage';

const renders = vi.hoisted(() => ({
  files: 0,
  editor: 0,
  chat: 0,
  evals: 0,
  plan: 0,
}));

vi.mock('react-grid-layout', async (orig) => ({
  ...(await orig<typeof import('react-grid-layout')>()),
  useContainerWidth: () => ({
    width: 1200,
    mounted: true,
    containerRef: { current: null },
    measureWidth: () => undefined,
  }),
}));
vi.mock('../api/ws', () => ({ useSpaceEvents: vi.fn(), send: vi.fn() }));
vi.mock('../features/chat', () => ({
  ChatProvider: ({ children }: { children: React.ReactNode }) => children,
  ChatPanel: () => {
    renders.chat++;
    return <p>chat</p>;
  },
  useChatStats: () => ({}),
  useChatActions: () => ({ send: vi.fn() }),
}));
vi.mock('../features/plans', () => ({
  PlanPanel: () => {
    renders.plan++;
    return <p>plan</p>;
  },
}));
vi.mock('../features/evals', () => ({
  EvalsTab: () => {
    renders.evals++;
    return <p>evals</p>;
  },
  copyPrefs: vi.fn(),
  evalResultKeys: () => [],
  useEvalRuns: () => ({ data: undefined }),
}));
vi.mock('../features/context', () => ({ configKey: () => ['config'] }));
vi.mock('../features/files', () => ({
  fileKey: () => ['file'],
  treeKey: () => ['tree'],
  NewFileDialog: () => null,
  FileEditor: ({ path }: { path: string }) => {
    renders.editor++;
    return <p>editing {path}</p>;
  },
  FileTree: (p: {
    selected: string | null;
    expanded: ReadonlySet<string>;
    onSelect: (path: string) => void;
    onToggle: (dir: string) => void;
  }) => {
    renders.files++;
    return (
      <div>
        <button onClick={() => p.onToggle('src')}>toggle src</button>
        <button onClick={() => p.onSelect('src/a.ts')}>open a</button>
        <p>
          expanded: {[...p.expanded].join(',')} selected: {p.selected ?? '-'}
        </p>
      </div>
    );
  },
}));
vi.mock('../features/runs', () => ({
  OpenTraceFile: () => null,
  RunsWidget: () => null,
}));
vi.mock('../features/settings', () => ({ SettingsMenu: () => null }));
vi.mock('../features/featureflags', () => ({
  FeaturesMenu: () => null,
  useFeatures: () => ({
    data: {
      git: true,
      autoCommit: false,
      masterLoop: true,
      userSettings: false,
    },
  }),
}));
vi.mock('../features/spaces', () => ({
  useSpace: (id: string) => ({ id, name: 'Space', path: '/p' }),
}));
vi.mock('../features/graph', () => ({ GraphWidget: () => null }));
vi.mock('../features/versions', () => ({ VersionsWidget: () => null }));
vi.mock('../features/git', () => ({ GitWidget: () => null }));
vi.mock('../features/experiments', () => ({ ExperimentsWidget: () => null }));
vi.mock('../features/hooks', () => ({ HooksWidget: () => null }));
vi.mock('../features/skills', () => ({ SkillsWidget: () => null }));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider>
        <MemoryRouter initialEntries={['/space/s1']}>
          <Routes>
            <Route path="/space/:id" element={<WorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe('WorkspacePage re-renders', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.keys(renders).forEach(
      (k) => (renders[k as keyof typeof renders] = 0),
    );
  });

  it('a folder toggle re-renders only the files widget', () => {
    renderPage();
    expect(screen.getByText('chat')).toBeTruthy();
    expect(screen.getByText('evals')).toBeTruthy();
    const before = { ...renders };
    fireEvent.click(screen.getByText('toggle src'));
    expect(screen.getByText(/expanded: src/)).toBeTruthy();
    expect(renders.files).toBeGreaterThan(before.files);
    expect(renders.chat).toBe(before.chat);
    expect(renders.evals).toBe(before.evals);
    expect(renders.plan).toBe(before.plan);
    expect(renders.editor).toBe(before.editor);
  });

  it('selecting a file re-renders the tree and the editor, not chat or evals', () => {
    renderPage();
    const before = { ...renders };
    act(() => fireEvent.click(screen.getByText('open a')));
    expect(screen.getByText('editing src/a.ts')).toBeTruthy();
    expect(screen.getByText(/selected: src\/a.ts/)).toBeTruthy();
    expect(renders.chat).toBe(before.chat);
    expect(renders.evals).toBe(before.evals);
    expect(renders.plan).toBe(before.plan);
  });
});
