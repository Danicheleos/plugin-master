import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OptimizeDescription } from './OptimizeDescription';

vi.mock('../../api/ws', () => ({ useSpaceEvents: vi.fn(), send: vi.fn() }));
const request = vi.hoisted(() => vi.fn());
vi.mock('../../api/http', async (orig) => ({ ...(await orig<object>()), request }));

const c = (name: string, tags: string[]) => ({ name, dir: `evals/${name}`, tags });
let cases: ReturnType<typeof c>[];

beforeEach(() => {
  cases = [c('a', ['trigger']), c('b', ['trigger']), c('h', ['trigger', 'holdout']), c('x', [])];
  request.mockReset().mockImplementation(async (method: string, url: string) => {
    if (method === 'POST') return { id: 7 };
    if (url.endsWith('/evals/suite')) return { cases, tags: [] };
    return [];
  });
});

function renderButton() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <OptimizeDescription spaceId="s" skill="demo" />
      </MantineProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText('Optimize description'));
}
const post = () => request.mock.calls.find((x) => x[0] === 'POST');

describe('OptimizeDescription', () => {
  it('shows the train/holdout counts and starts a description experiment', async () => {
    renderButton();
    expect(await screen.findByText('2')).toBeTruthy(); // train
    expect(screen.getByText('1')).toBeTruthy(); // holdout
    fireEvent.change(screen.getByLabelText('Max cost (USD)'), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText('Iterations'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => expect(post()).toBeTruthy());
    expect(post()![1]).toMatch(/experiments\/run$/);
    expect(post()![2]).toEqual({ kind: 'description', skill: 'demo', maxCostUsd: 1.5, iterations: 2 });
    expect(await screen.findByText(/Started experiment 7/)).toBeTruthy();
  });

  it('blocks the start without train cases and hints to tag cases', async () => {
    cases = [c('x', [])];
    renderButton();
    expect(await screen.findByText(/Add at least one "trigger" case first/)).toBeTruthy();
    fireEvent.click(screen.getByText('Start'));
    expect(post()).toBeUndefined();
  });
});
