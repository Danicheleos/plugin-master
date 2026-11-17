import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@pm/protocol';

describe('spaceUrl', () => {
  it('encodes every segment, the space id too', async () => {
    const { spaceUrl, query, idParts } = await import('./space');
    expect(spaceUrl('s')).toBe('/api/spaces/s');
    expect(spaceUrl('a/b?', 'runs', 'x y', 3)).toBe(
      '/api/spaces/a%2Fb%3F/runs/x%20y/3',
    );
    expect(spaceUrl('s', 'evals', ...idParts('plugin-eval/x'))).toBe(
      '/api/spaces/s/evals/plugin-eval/x',
    );
    expect(query({ path: 'a b&c', n: 2, none: undefined })).toBe(
      '?path=a%20b%26c&n=2',
    );
    expect(query({})).toBe('');
  });
});

describe('useSpaceInvalidate', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.resetModules());

  it('invalidates only the given keys when the message matches', async () => {
    let handler: (m: ServerMessage) => void = () => undefined;
    vi.doMock('./ws', () => ({
      useSpaceEvents: (_id: string, h: (m: ServerMessage) => void) => {
        handler = h;
      },
    }));
    const { useSpaceInvalidate } = await import('./space');
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    renderHook(
      () =>
        useSpaceInvalidate('s', (m) => m.type === 'git.changed', [
          ['git', 's'],
          ['versions', 's'],
        ]),
      { wrapper },
    );
    act(() => handler({ type: 'plans.changed', spaceId: 's' }));
    expect(spy).not.toHaveBeenCalled();
    act(() => handler({ type: 'git.changed', spaceId: 's' }));
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toEqual([
      ['git', 's'],
      ['versions', 's'],
    ]);
  });
});
