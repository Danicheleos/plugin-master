import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpaceEvents } from '../../api/ws';
import { GitWidget } from './GitWidget';

vi.mock('../../api/ws', () => ({ useSpaceEvents: vi.fn(), send: vi.fn() }));
vi.mock('../chat/ChatContext', () => ({ useOnChatIdle: () => undefined }));
vi.mock('@monaco-editor/react', () => ({
  DiffEditor: ({ original, modified }: { original: string; modified: string }) => (
    <div data-testid="diff">{`${original}>${modified}`}</div>
  ),
}));
const request = vi.hoisted(() => vi.fn());
vi.mock('../../api/http', async (orig) => ({ ...(await orig<object>()), request }));

const files = [
  { path: 'a.txt', index: ' ', workingDir: 'M' },
  { path: 'b.txt', index: '?', workingDir: '?' },
];
let status: object;
let branches = { current: 'main', local: ['main', 'dev'] };

beforeEach(() => {
  status = { isRepo: true, branch: 'main', files };
  branches = { current: 'main', local: ['main', 'dev'] };
  request.mockReset().mockImplementation(async (method: string, url: string) => {
    if (url.endsWith('/status')) return status;
    if (url.endsWith('/branches')) return branches;
    if (url.includes('/log')) return [];
    if (url.includes('/diff')) return { path: 'a.txt', old: 'old', new: 'new' };
    return {};
  });
});

function renderWidget() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <GitWidget spaceId="s" />
      </MantineProvider>
    </QueryClientProvider>,
  );
}
const post = (path: string) =>
  request.mock.calls.find((c) => c[0] === 'POST' && (c[1] as string).endsWith(path));

describe('GitWidget', () => {
  it('debounces fs.changed to a status refetch; git.changed refetches everything at once', async () => {
    renderWidget();
    await screen.findByText('a.txt');
    await waitFor(() => expect(request.mock.calls.some((c) => (c[1] as string).endsWith('/log?limit=30'))).toBe(true));
    const handler = () =>
      vi.mocked(useSpaceEvents).mock.calls.at(-1)?.[1] as (m: { type: string }) => void;
    const count = (end: string) =>
      request.mock.calls.filter((c) => (c[1] as string).endsWith(end)).length;
    const [statuses, logs] = [count('/status'), count('/log?limit=30')];
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 3; i++) handler()({ type: 'fs.changed' });
      await vi.advanceTimersByTimeAsync(299);
      expect(count('/status')).toBe(statuses);
      await vi.advanceTimersByTimeAsync(1);
      expect(count('/status')).toBe(statuses + 1);
      expect(count('/log?limit=30')).toBe(logs); // log is not refetched by file changes
      handler()({ type: 'git.changed' });
      await vi.advanceTimersByTimeAsync(0);
      expect(count('/log?limit=30')).toBe(logs + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('not a repo: offers init', async () => {
    status = { isRepo: false };
    renderWidget();
    fireEvent.click(await screen.findByText('Initialize repository'));
    await waitFor(() => expect(post('/git/init')).toBeTruthy());
  });

  it('lists changes and requests the diff of a clicked file', async () => {
    renderWidget();
    fireEvent.click(await screen.findByText('a.txt'));
    expect(await screen.findByText('old>new')).toBeTruthy();
    expect(request.mock.calls.some((c) => (c[1] as string).includes('diff?path=a.txt'))).toBe(true);
  });

  it('commits the checked files with the message', async () => {
    renderWidget();
    await screen.findByText('b.txt');
    fireEvent.click(screen.getByLabelText('Commit b.txt'));
    fireEvent.change(screen.getByPlaceholderText('Commit message'), { target: { value: 'msg' } });
    fireEvent.click(screen.getByText('Commit selected (1)'));
    await waitFor(() =>
      expect(post('/git/commit')?.[2]).toEqual({ message: 'msg', paths: ['a.txt'] }),
    );
  });

  it('switching with a dirty tree asks, then carries', async () => {
    renderWidget();
    await screen.findByText('a.txt');
    await waitFor(() => expect(request.mock.calls.some((c) => (c[1] as string).endsWith('/branches'))).toBe(true));
    fireEvent.click(screen.getAllByLabelText('Branch')[0]);
    fireEvent.click(await screen.findByText('dev'));
    expect(await screen.findByText(/GIT_DIRTY/)).toBeTruthy();
    expect(post('/git/switch')).toBeUndefined();
    fireEvent.click(screen.getByText('Switch anyway (keep my changes)'));
    await waitFor(() => expect(post('/git/switch')?.[2]).toEqual({ name: 'dev', carry: true }));
  });
});
