import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { EvalRunResultSchema, EvalSuitesResponseSchema, TraceSchema, type EvalCase } from '@pm/protocol';
import { describe, expect, it } from 'vitest';
import { EvalCompare } from './EvalCompare';
import { TraceModal } from './TraceView';
import { evalRunsKey, evalsKey } from './hooks';

const metrics = {
  modelCalls: 4,
  subagentModelCalls: 0,
  toolCalls: { Bash: 2 },
  toolCallsTotal: 2,
  toolErrors: 0,
  subagents: [],
  maxContext: 20000,
  finalContext: 20000,
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 1,
  cacheCreationTokens: 1,
  permissionDenials: 0,
  badLines: 0,
};

const run = (score: number, pass: boolean, costUsd: number, m?: object) =>
  EvalRunResultSchema.parse({
    score,
    costUsd,
    judgeCostUsd: 0.01,
    turns: 3,
    graders: [{ name: 'g1', passed: pass }],
    ...(m && { traceMetrics: m }),
  });

const wrap = (qc: QueryClient, ui: React.ReactNode) => (
  <QueryClientProvider client={qc}>
    <MantineProvider>{ui}</MantineProvider>
  </QueryClientProvider>
);

describe('EvalCompare', () => {
  it('puts the with arm next to the without arm and highlights changed graders', () => {
    const qc = new QueryClient();
    qc.setQueryData(evalRunsKey('s'), { dir: 'evals', groups: [] });
    const c = {
      name: 'delta',
      graders: [],
      aggregates: {},
      arms: { with: [run(1, true, 0.1, metrics)], without: [run(0.5, false, 0.2)] },
    } as EvalCase;
    render(wrap(qc, <EvalCompare spaceId="s" runId="r" cases={[c]} />));
    expect(screen.getByText('1.00 vs 0.50 (+0.50)')).toBeTruthy();
    expect(screen.getByText('g1')).toHaveProperty('className', expect.stringMatching(/changed/));
    expect(screen.getByText('20k vs - (-)')).toBeTruthy();
  });

  it('offers only runs of the focused case, from every suite', () => {
    const qc = new QueryClient();
    qc.setQueryData(evalRunsKey('s'), { dir: 'evals', groups: [] });
    const row = (runId: string, startedAt: string) => ({ runId, startedAt, model: 'm', score: 0.5 });
    const entry = (name: string, runs: ReturnType<typeof row>[]) => ({
      name,
      runCount: runs.length,
      latest: runs[0],
      trend: [],
      sections: [{ kind: 'none', runs }],
    });
    qc.setQueryData(
      [...evalsKey('s'), 'suites'],
      EvalSuitesResponseSchema.parse({
        dir: 'evals',
        suites: [
          {
            key: 'p',
            label: 'plugin suite',
            kind: 'main',
            runCount: 3,
            cases: [
              entry('mine', [row('cur', '2026-10-12T10:00:00Z'), row('old', '2026-10-11T10:00:00Z')]),
              entry('other', [row('elsewhere', '2026-10-10T10:00:00Z')]),
            ],
          },
        ],
      }),
    );
    const c = { name: 'mine', graders: [], aggregates: {}, arms: { with: [run(1, true, 0.1)], without: [] } } as EvalCase;
    render(wrap(qc, <EvalCompare spaceId="s" runId="cur" cases={[c]} focusCase="mine" />));
    fireEvent.click(screen.getAllByLabelText('Compare with')[0] as HTMLElement);
    expect(screen.getByText(/plugin suite/)).toBeTruthy(); // the older run of "mine"
    expect(screen.getAllByText(/plugin suite/)).toHaveLength(1); // not the current run, not "other"
  });
});

describe('TraceModal', () => {
  it('shows metrics, turns, collapsible tool output and subagent turns', () => {
    const qc = new QueryClient();
    const target = { runId: 'r', case: 'delta', arm: 'with' as const, n: 1 };
    qc.setQueryData(
      [...evalsKey('s'), 'run', 'r', 'trace', 'delta', 'with', 1],
      TraceSchema.parse({
        metrics: { ...metrics, numTurns: 3 },
        turns: [
          {
            id: 'm1',
            context: 1000,
            outputTokens: 10,
            text: 'Looking around.',
            tools: [
              {
                id: 't1',
                name: 'Task',
                input: '{"prompt":"p"}',
                result: { preview: 'report', isError: false },
                turns: [{ id: 's1', context: 500, outputTokens: 5, tools: [] }],
              },
            ],
          },
          { id: 'm2', context: 1500, outputTokens: 5, tools: [] },
        ],
      }),
    );
    render(wrap(qc, <TraceModal spaceId="s" target={target} onClose={() => undefined} />));
    expect(screen.getByText(/4 model calls/)).toBeTruthy();
    expect(screen.getByText('Looking around.')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Context per model call/ })).toBeTruthy();
    expect(screen.getByText(/context 500/)).toBeTruthy(); // nested subagent turn
    fireEvent.click(screen.getByText(/Task/));
    expect(screen.getByText('report')).toBeTruthy();
  });
});
