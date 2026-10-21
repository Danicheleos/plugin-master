import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EvalRunsResponseSchema } from '@pm/protocol';
import { describe, expect, it, vi } from 'vitest';
import { EvalRunsList } from './EvalRunsList';
import { evalRunsKey } from './hooks';

const summary = (id: string, startedAt: string) => ({ id, startedAt, overallScore: 1, casesPassed: 1, casesTotal: 1 });
const a = summary('a', '2026-10-12T23:34:00.000Z');
const b = summary('b', '2026-10-12T23:40:00.000Z');
const solo = summary('solo', '2026-10-10T09:00:00.000Z');

const data = EvalRunsResponseSchema.parse({
  dir: 'evals',
  groups: [
    {
      id: 'a',
      startedAt: a.startedAt,
      endedAt: '2026-10-12T23:45:00.000Z',
      runIds: ['a', 'b'],
      runs: [a, b],
      totalRuns: 6,
      score: 0.75,
      casesPassed: 1,
      casesTotal: 2,
      costUsd: 3.5,
      durationSeconds: 660,
      modelOverride: 'claude-sonnet-5-5',
    },
    { id: 'solo', startedAt: solo.startedAt, runIds: ['solo'], runs: [solo], totalRuns: 3, score: 1, casesPassed: 1, casesTotal: 1 },
  ],
});

function renderList(onOpen = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(evalRunsKey('s'), data);
  render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <EvalRunsList spaceId="s" onOpen={onOpen} />
      </MantineProvider>
    </QueryClientProvider>,
  );
  return onOpen;
}

describe('EvalRunsList', () => {
  it('shows groups with aggregates and opens a group or a single run', () => {
    const onOpen = renderList();
    expect(screen.getByText('2026-10-12 23:34 – 23:45')).toBeTruthy();
    expect(screen.getByText('2 invocations')).toBeTruthy();
    expect(screen.getByText('$3.50')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.getAllByText('0.75').length).toBeGreaterThan(1); // table cell and the score chart's last value
    expect(screen.getByLabelText('Score')).toBeTruthy();
    fireEvent.click(screen.getByText('2026-10-12 23:34 – 23:45'));
    expect(onOpen).toHaveBeenLastCalledWith('a', true);
    fireEvent.click(screen.getByText('2026-10-10 09:00'));
    expect(onOpen).toHaveBeenLastCalledWith('solo', false);
  });

  it('expands a group to open one invocation', () => {
    const onOpen = renderList();
    expect(screen.queryByText(/· b$/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Invocations'));
    fireEvent.click(screen.getByText(/· b$/));
    expect(onOpen).toHaveBeenLastCalledWith('b', false);
  });

  it('keeps an expanded group expanded after a remount (back from a run)', () => {
    const first = renderList();
    fireEvent.click(screen.getByLabelText('Invocations'));
    cleanup();
    renderList(first);
    expect(screen.getByText(/· b$/)).toBeTruthy();
  });
});
