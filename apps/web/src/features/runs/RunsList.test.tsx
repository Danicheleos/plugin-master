import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunsList } from './RunsList';
import { runsKey } from './hooks';

const meta = {
  id: 'r1',
  title: 'Fix the skill',
  startedAt: '2026-10-12T23:34:00.000Z',
  endedAt: '2026-10-12T23:40:00.000Z',
  turns: 3,
  costUsd: 0.5,
  models: ['claude-sonnet-5-5'],
  commit: 'abcdef123456',
};
const metrics = {
  modelCalls: 1, toolCallsTotal: 0, toolErrors: 0, permissionDenials: 0, badLines: 0,
  subagents: [], inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0,
  maxContext: 1, model: 'trace-model',
};

function renderList(runs: unknown, trace?: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(runsKey('s'), { runs });
  if (trace) qc.setQueryData([...runsKey('s'), 'r1', 'trace'], trace);
  render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <RunsList spaceId="s" />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe('RunsList', () => {
  it('shows the empty state', () => {
    renderList([]);
    expect(screen.getByText('No runs yet')).toBeTruthy();
  });

  it('lists runs and an error row', () => {
    renderList([meta, { id: 'bad', error: 'broken meta' }]);
    expect(screen.getByText('Fix the skill')).toBeTruthy();
    expect(screen.getByText('abcdef1')).toBeTruthy();
    expect(screen.getByText('$0.50')).toBeTruthy();
    expect(screen.getByText('error')).toBeTruthy();
  });

  it('opens the trace modal on click', () => {
    renderList([meta], { metrics, turns: [], prompt: 'hi' });
    fireEvent.click(screen.getByText('Fix the skill'));
    expect(screen.getByText('Run: Fix the skill')).toBeTruthy();
    expect(screen.getByText(/trace-model/)).toBeTruthy();
  });
});
