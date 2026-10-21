import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphWidget } from './GraphWidget';

vi.mock('../../api/ws', () => ({ useSpaceEvents: vi.fn(), send: vi.fn() }));
vi.mock('./GraphView', () => ({
  default: ({ nodes, edges, onOpen }: { nodes: { id: string; label: string; file?: string }[]; edges: { id: string }[]; onOpen: (p: string) => void }) => (
    <div>
      {nodes.map((n) => (
        <button key={n.id} onClick={() => n.file && onOpen(n.file)}>{n.label}</button>
      ))}
      <span data-testid="edges">{edges.map((e) => e.id).join(',')}</span>
    </div>
  ),
}));
const request = vi.hoisted(() => vi.fn());
vi.mock('../../api/http', async (orig) => ({ ...(await orig<object>()), request }));

const node = (name: string, type: 'file' | 'dir', dir = '') => ({ name, path: dir ? `${dir}/${name}` : name, type });
const tree: Record<string, object[]> = {
  '': [node('skills', 'dir'), node('scripts', 'dir'), node('plugin.json', 'file')],
  skills: [node('a', 'dir', 'skills')],
  'skills/a': [node('SKILL.md', 'file', 'skills/a')],
  scripts: [node('go.sh', 'file', 'scripts')],
};

beforeEach(() => {
  request.mockReset().mockImplementation(async (_m: string, url: string) => {
    if (url.includes('/tree?dir=')) return tree[decodeURIComponent(url.split('dir=')[1]!)] ?? [];
    if (url.includes('/file?path=')) return { path: 'skills/a/SKILL.md', content: '---\nname: a\n---\nSee scripts/go.sh\n' };
    if (url.endsWith('/hooks')) return { events: [], sources: [], entries: [{ source: 'plugin', file: 'hooks/hooks.json', event: 'Stop', group: 0, handlers: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/scripts/go.sh' }], problems: [] }] };
    if (url.endsWith('/evals/suite')) return { cases: [{ name: 'case1', dir: 'evals/case1', tags: [] }], tags: [] };
    return {};
  });
});

describe('GraphWidget', () => {
  it('renders nodes from the space and opens a file on click', async () => {
    const onOpenFile = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MantineProvider>
          <GraphWidget spaceId="s" onOpenFile={onOpenFile} />
        </MantineProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByText('a'));
    expect(onOpenFile).toHaveBeenCalledWith('skills/a/SKILL.md');
    expect(screen.getByText('case1')).toBeTruthy();
    expect(screen.getByTestId('edges')).toBeTruthy();
    expect(screen.getByText(/skills\/a\/SKILL\.md>file:scripts\/go\.sh/)).toBeTruthy();
    expect(screen.getByText(/hook:hooks\/hooks\.json:Stop:0>file:scripts\/go\.sh/)).toBeTruthy();
  });
});
