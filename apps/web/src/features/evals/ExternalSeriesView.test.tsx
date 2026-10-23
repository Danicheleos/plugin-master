import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ExternalSeries } from '@pm/protocol';
import { ExternalSeriesView } from './ExternalSeriesView';

const series: ExternalSeries = {
  kind: 'eval-series',
  series: 's1',
  arm: 'bare',
  startedAt: new Date(Date.now() - 65_000).toISOString(),
  updatedAt: new Date().toISOString(),
  finishedAt: null,
  runsPerCase: 3,
  total: 2,
  done: 1,
  current: 'b',
  costUsd: 0.4,
  cases: [
    { name: 'alpha', state: 'done', score: 0.5, costUsd: 0.4 },
    { name: 'beta', state: 'running', score: null, costUsd: null },
  ],
};

const view = (s: ExternalSeries) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider>
        <ExternalSeriesView spaceId="x" series={s} />
      </MantineProvider>
    </QueryClientProvider>,
  );

describe('ExternalSeriesView', () => {
  it('shows label, progress, runs per case, cost and elapsed', () => {
    view(series);
    expect(screen.getByText('running (external)')).toBeTruthy();
    expect(screen.getByText('1 of 2 cases')).toBeTruthy();
    expect(screen.getByText('0.50')).toBeTruthy();
    expect(screen.getByText(/3 runs per case · \$0\.40 so far · 1:0[5-9]/)).toBeTruthy();
  });

  it('labels a finished series', () => {
    view({ ...series, finishedAt: new Date().toISOString() });
    expect(screen.getByText('finished (external)')).toBeTruthy();
  });
});
