import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { EvalSuitesResponseSchema } from '@pm/protocol';
import { describe, expect, it, vi } from 'vitest';
import { EvalSuitesList } from './EvalSuitesList';
import { evalsKey } from './hooks';

const row = (runId: string, startedAt: string, score: number, baselineScore?: number) => ({
  runId,
  startedAt,
  model: 'm',
  score,
  baselineScore,
  delta: baselineScore === undefined ? undefined : score - baselineScore,
  costUsd: 0.5,
  turns: 4,
  maxContext: 24000,
});

const data = EvalSuitesResponseSchema.parse({
  dir: 'evals',
  suites: [
    {
      key: 'plug · evals/cases',
      label: 'plug · evals/cases',
      kind: 'main',
      runCount: 4,
      cases: [
        {
          name: 'alpha',
          runCount: 4,
          lastRunAt: '2026-10-16T10:00:00.000Z',
          latest: row('r4', '2026-10-16T10:00:00.000Z', 0.75, 0.5),
          trend: [0.25, 0.5, 0.75],
          sections: [
            {
              kind: 'run',
              baseline: { runId: 'bare.json', startedAt: '2026-10-15T06:55:00.000Z', score: 0.5, model: 'm', after: false },
              runs: [row('r4', '2026-10-16T10:00:00.000Z', 0.75, 0.5)],
            },
            {
              kind: 'run',
              baseline: { runId: 'bare.json', startedAt: '2026-10-15T06:55:00.000Z', score: 0.5, model: 'm', after: true },
              runs: [row('r2', '2026-10-12T10:00:00.000Z', 0.5, 0.5)],
            },
            { kind: 'ablation', runs: [row('r3', '2026-10-13T10:00:00.000Z', 1, 0.25)] },
            { kind: 'none', runs: [row('r1', '2026-10-11T10:00:00.000Z', 0.25)] },
          ],
        },
      ],
    },
    {
      key: 'naked · evals/bare',
      label: 'naked · evals/bare',
      kind: 'baseline',
      runCount: 1,
      cases: [
        {
          name: 'alpha',
          runCount: 1,
          lastRunAt: '2026-10-15T06:55:00.000Z',
          latest: row('bare.json', '2026-10-15T06:55:00.000Z', 0.5),
          trend: [0.5],
          sections: [{ kind: 'none', runs: [row('bare.json', '2026-10-15T06:55:00.000Z', 0.5)] }],
        },
      ],
    },
  ],
});

describe('EvalSuitesList', () => {
  it('shows suites, cases and runs per baseline; opens a run and a comparison', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData([...evalsKey('s'), 'suites'], data);
    const onOpen = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <MantineProvider>
          <EvalSuitesList spaceId="s" onOpen={onOpen} />
        </MantineProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('plug · evals/cases')).toBeTruthy();
    expect(screen.getByText('naked · evals/bare')).toBeTruthy();
    expect(screen.getByText('baseline')).toBeTruthy();
    expect(screen.getAllByText('+0.25').length).toBeGreaterThan(0); // latest delta in the case row
    expect(screen.getByLabelText('Last 3 scores of alpha')).toBeTruthy();
    expect(screen.queryByText('No baseline')).toBeNull();

    fireEvent.click(screen.getAllByText(/alpha/)[0] as HTMLElement);
    expect(screen.getAllByText(/^Baseline 2026-10-15 06:55/)).toHaveLength(2);
    expect(screen.getByText('after')).toBeTruthy();
    expect(screen.getByText('Ablation arm (without the plugin)')).toBeTruthy();
    expect(screen.getByText('No baseline')).toBeTruthy();

    fireEvent.click(screen.getAllByText('2026-10-16 10:00')[1] as HTMLElement); // [0] is the case's last-run cell
    expect(onOpen).toHaveBeenLastCalledWith('r4', 'alpha');
    const compares = screen.getAllByText('compare');
    expect(compares).toHaveLength(3); // run, run (after), ablation; none has no baseline
    fireEvent.click(compares[0] as HTMLElement);
    expect(onOpen).toHaveBeenLastCalledWith('r4', 'alpha', 'bare.json');
    fireEvent.click(compares[2] as HTMLElement); // third section = ablation
    expect(onOpen).toHaveBeenLastCalledWith('r3', 'alpha', 'ablation');
  });

  it('shows a trend chart per metric with at least two values in an expanded case', () => {
    const run = (runId: string, startedAt: string, extra = {}) => ({ runId, startedAt, model: 'm', ...extra });
    const runs = [
      run('r2', '2026-10-12T10:00:00.000Z', { score: 1, costUsd: 0.4, turns: 3, tokens: 9000, commit: 'abcdef1234567', baselineMetrics: { score: 0.25, costUsd: 0.8 } }),
      run('r1', '2026-10-11T10:00:00.000Z', { score: 0.5, costUsd: 0.6, turns: 5, baselineMetrics: { score: 0.5 } }),
    ];
    const one = EvalSuitesResponseSchema.parse({
      dir: 'evals',
      suites: [
        {
          key: 'k',
          label: 'k',
          kind: 'main',
          runCount: 2,
          cases: [{ name: 'beta', runCount: 2, latest: runs[0], trend: [0.5, 1], sections: [{ kind: 'none', runs }] }],
        },
      ],
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData([...evalsKey('s'), 'suites'], one);
    render(
      <QueryClientProvider client={qc}>
        <MantineProvider>
          <EvalSuitesList spaceId="s" onOpen={vi.fn()} />
        </MantineProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByLabelText('Score')).toBeNull(); // collapsed
    fireEvent.click(screen.getAllByText(/beta/)[0] as HTMLElement);
    for (const l of ['Score', 'Cost', 'Turns']) expect(screen.getByLabelText(l)).toBeTruthy();
    for (const l of ['Pass rate', 'Max context', 'Tokens', 'Duration']) expect(screen.queryByLabelText(l)).toBeNull();
    expect(screen.getByText('2026-10-12 10:00 · 1.00 (baseline 0.25) · abcdef1')).toBeTruthy(); // tooltip with commit
    expect(screen.getByText('2026-10-11 10:00 · 0.50 (baseline 0.50)')).toBeTruthy();
    // baseline series only where the data exists: score on both runs, cost on one, turns on none
    expect(screen.getAllByTestId(/^baseline-/)).toHaveLength(3);
    expect(screen.getAllByText(/dashed: baseline/)).toHaveLength(2);
  });
});
