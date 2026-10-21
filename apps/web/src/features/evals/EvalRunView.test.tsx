import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { EvalGroupResponseSchema, EvalRunResponseSchema } from '@pm/protocol';
import { describe, expect, it, vi } from 'vitest';
import { EvalRunView } from './EvalRunView';
import { evalsKey } from './hooks';

// trimmed from a real two-arm aggregate-result.json
const twoArm = {
  schemaVersion: 1,
  suite: { root: '.', ablation: 'with-without', threshold: 1 },
  aggregates: { casesTotal: 1, casesPassed: 1, overallScore: 1 },
  cases: [
    {
      name: 'delta',
      dir: 'evals/cases/delta',
      graders: [{ name: 'g1', type: 'regex', weight: 1 }],
      arms: {
        with: [
          { score: 1, passed: true, graders: [{ name: 'g1', passed: true }] },
        ],
        without: [
          {
            score: 0.5,
            passed: false,
            graders: [
              {
                name: 'g1',
                passed: false,
                withOnly: true,
                scored: false,
                evidence: 'line 1',
              },
            ],
          },
        ],
      },
      aggregates: { score: 1, scoreWithout: 0.5, delta: 0.5 },
    },
  ],
};

describe('EvalRunView', () => {
  it('drills down from case to arm, run and grader evidence', () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    qc.setQueryData(
      [...evalsKey('s'), 'run', 'r'],
      EvalRunResponseSchema.parse({
        id: 'r',
        unknownSchema: false,
        result: twoArm,
      }),
    );
    const onOpenFile = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <MantineProvider>
          <EvalRunView
            spaceId="s"
            runId="r"
            onBack={() => undefined}
            onOpenFile={onOpenFile}
            spaceRoot="/x"
          />
        </MantineProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('+0.50')).toBeTruthy();
    fireEvent.click(screen.getByText(/▸ delta/));
    expect(screen.getByText('Arm: with')).toBeTruthy();
    expect(screen.getByText('Arm: without')).toBeTruthy();
    expect(screen.getByText(/not scored/)).toBeTruthy();
    fireEvent.click(screen.getAllByText('details')[0] as HTMLElement);
    expect(screen.getByText('line 1')).toBeTruthy();
    fireEvent.click(screen.getByText('open'));
    expect(onOpenFile).toHaveBeenCalledWith('evals/cases/delta/prompt.md');
  });

  it('focuses one case, opened, without the comparison', () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const other = { ...twoArm.cases[0], name: 'other' };
    qc.setQueryData(
      [...evalsKey('s'), 'run', 'r'],
      EvalRunResponseSchema.parse({
        id: 'r',
        unknownSchema: false,
        result: { ...twoArm, cases: [other, ...twoArm.cases] },
      }),
    );
    qc.setQueryData([...evalsKey('s'), 'runs'], { dir: 'evals', groups: [] });
    render(
      <QueryClientProvider client={qc}>
        <MantineProvider>
          <EvalRunView
            spaceId="s"
            runId="r"
            focusCase="delta"
            compareWith="ablation"
            onBack={() => undefined}
          />
        </MantineProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/other/)).toBeNull();
    expect(screen.queryByText('Arm: with')).toBeNull(); // the case is collapsed
    fireEvent.click(screen.getByText(/▸ delta/));
    expect(screen.getByText('Arm: with')).toBeTruthy();
    expect(screen.queryByText('Compare with')).toBeNull();
  });

  it('shows a merged group with a per-case report link', () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const run = (id: string) => ({ id, hasReport: true });
    qc.setQueryData(
      [...evalsKey('s'), 'run', 'r1', 'group'],
      EvalGroupResponseSchema.parse({
        id: 'r1',
        unknownSchema: false,
        group: {
          id: 'r1',
          runIds: ['r1', 'r2'],
          runs: [run('r1'), run('r2')],
          totalRuns: 2,
        },
        result: { ...twoArm, cases: [{ ...twoArm.cases[0], runId: 'r2' }] },
      }),
    );
    render(
      <QueryClientProvider client={qc}>
        <MantineProvider>
          <EvalRunView spaceId="s" runId="r1" group onBack={() => undefined} />
        </MantineProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('2 invocations')).toBeTruthy();
    expect(screen.queryByText('Open HTML report')).toBeNull();
    expect(screen.getByText('report')).toBeTruthy();
  });

  it('lists every invocation of a case repeated in a group', () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const run = (id: string, startedAt: string) => ({
      id,
      startedAt,
      hasReport: false,
    });
    qc.setQueryData(
      [...evalsKey('s'), 'run', 'r1', 'group'],
      EvalGroupResponseSchema.parse({
        id: 'r1',
        unknownSchema: false,
        group: {
          id: 'r1',
          runIds: ['r1', 'r2', 'r3'],
          runs: [
            run('r1', '2026-10-17T10:00:00Z'),
            run('r2', '2026-10-17T10:05:00Z'),
            run('r3', '2026-10-17T10:10:00Z'),
          ],
          totalRuns: 3,
        },
        result: {
          ...twoArm,
          cases: ['r1', 'r2', 'r3'].map((runId) => ({
            ...twoArm.cases[0],
            runId,
          })),
        },
      }),
    );
    render(
      <QueryClientProvider client={qc}>
        <MantineProvider>
          <EvalRunView spaceId="s" runId="r1" group onBack={() => undefined} />
        </MantineProvider>
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole('button', { name: /▸ delta/ })).toHaveLength(3);
    expect(screen.getByText('3 invocations')).toBeTruthy();
  });
});
