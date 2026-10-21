import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EvalTargetsResponseSchema } from '@pm/protocol';
import { describe, expect, it, vi } from 'vitest';
import { EvalTargetsList } from './EvalTargetsList';
import { stamp } from './format';
import { evalsKey } from './hooks';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../api/http', async (orig) => ({ ...(await orig<object>()), request }));

const run = (
  runId: string,
  startedAt: string,
  score: number,
  base: number,
) => ({
  runId,
  startedAt,
  model: 'm',
  score,
  turns: 3,
  baselineScore: base,
  delta: score - base,
  baselineMetrics: { score: base },
});
const runs = [
  run('r2', '2026-10-12T10:00:00.000Z', 0.75, 0.5),
  run('r1', '2026-10-11T10:00:00.000Z', 0.5, 0.5),
];

function view(data: unknown, onOpen = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(
    [...evalsKey('s'), 'targets'],
    EvalTargetsResponseSchema.parse(data),
  );
  render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <EvalTargetsList spaceId="s" onOpen={onOpen} />
      </MantineProvider>
    </QueryClientProvider>,
  );
  return onOpen;
}

describe('EvalTargetsList', () => {
  it('lists targets collapsed, expands to charts and cases, unmapped last', () => {
    const onOpen = view({
      targets: [
        {
          kind: 'skill',
          name: 'alpha',
          cases: [{ name: 'c1', lastRunId: 'r2', runs }],
          runs,
          contextBytes: 2048,
        },
        { kind: 'agent', name: 'rev', cases: [], runs: [] },
      ],
      unmapped: {
        name: 'Unmapped',
        cases: [{ name: 'u1', lastRunId: 'r2', runs: [] }],
        runs: [],
      },
    });
    expect(screen.getByText('skill')).toBeTruthy();
    expect(screen.getByText('agent')).toBeTruthy();
    expect(screen.getByText('unmapped')).toBeTruthy();
    expect(screen.getByText('0.75')).toBeTruthy();
    expect(screen.getByText('+0.25')).toBeTruthy();
    expect(screen.getByText('context 2.0 KB')).toBeTruthy();
    expect(screen.queryByLabelText('Score')).toBeNull();
    fireEvent.click(screen.getByText(/alpha/));
    expect(screen.getAllByLabelText('Score').length).toBeGreaterThan(0); // target overall
    // cases start collapsed; opening one shows its whole history, and a row opens that run
    expect(screen.queryByText(stamp(runs[1]?.startedAt) as string)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /▸ c1/ }));
    expect(screen.getAllByLabelText('Score').length).toBeGreaterThan(1); // + the case
    expect(screen.getByText(stamp(runs[1]?.startedAt) as string)).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: stamp(runs[0]?.startedAt) as string }),
    );
    expect(onOpen).toHaveBeenCalledWith('r2', 'c1');
    expect(screen.getByText(/Unmapped/)).toBeTruthy(); // collapsed, rendered last
  });

  it('explains the mapping rules when there are no cases', () => {
    view({ targets: [], unmapped: { name: 'Unmapped', cases: [], runs: [] } });
    expect(screen.getByText(/tool_used/)).toBeTruthy();
  });

  it('limits the runs with the "Last runs" input of the chart set', () => {
    view({
      targets: [
        {
          kind: 'skill',
          name: 'alpha',
          cases: [{ name: 'c1', lastRunId: 'r2', runs }],
          runs,
        },
      ],
      unmapped: { name: 'Unmapped', cases: [], runs: [] },
    });
    fireEvent.click(screen.getByText(/alpha/));
    fireEvent.click(screen.getByRole('button', { name: /▸ c1/ }));
    expect(screen.getByText(stamp(runs[1]?.startedAt) as string)).toBeTruthy();
    fireEvent.change(
      screen.getAllByLabelText('Last runs plotted')[0] as HTMLElement,
      { target: { value: '1' } },
    );
    expect(screen.queryByText(stamp(runs[1]?.startedAt) as string)).toBeNull();
    expect(
      screen.getByRole('button', { name: stamp(runs[0]?.startedAt) as string }),
    ).toBeTruthy();
  });

  it('pins a run as the baseline of its case and unpins it', async () => {
    const data = {
      targets: [
        {
          kind: 'skill',
          name: 'alpha',
          cases: [{ name: 'c1', lastRunId: 'r2', runs: [{ ...runs[0], pinned: true }, runs[1]] }],
          runs,
        },
      ],
      unmapped: { name: 'Unmapped', cases: [], runs: [] },
    };
    request.mockImplementation(async (method: string) =>
      method === 'GET' ? EvalTargetsResponseSchema.parse(data) : {},
    );
    view(data);
    fireEvent.click(screen.getByText(/alpha/));
    expect(screen.queryByRole('button', { name: 'Run c1' })).toBeNull();
    fireEvent.click(screen.getAllByText(/c1/)[0] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Set as baseline r1' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('PUT', '/api/spaces/s/evals/baseline', { case: 'c1', runId: 'r1' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Unset baseline r2' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('PUT', '/api/spaces/s/evals/baseline', { case: 'c1', runId: null }),
    );
  });
});
