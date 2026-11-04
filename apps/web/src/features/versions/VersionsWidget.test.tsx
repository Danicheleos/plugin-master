import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updatePrefs } from '../evals/prefs';
import { VersionsWidget } from './VersionsWidget';

vi.mock('../../api/ws', () => ({ useSpaceEvents: vi.fn(), send: vi.fn() }));
vi.mock('../chat/ChatContext', () => ({ useOnChatIdle: () => undefined }));
vi.mock('@monaco-editor/react', () => ({
  DiffEditor: (p: { originalModelPath: string; modifiedModelPath: string }) => (
    <div data-testid="diff">{`${p.originalModelPath} ${p.modifiedModelPath}`}</div>
  ),
}));
vi.mock('../evals/TraceView', () => ({
  TraceModal: ({
    target,
  }: {
    target: { runId: string; case: string; arm: string; n: number };
  }) => (
    <div data-testid="trace">{`${target.runId}/${target.case}/${target.arm}/${target.n}`}</div>
  ),
}));
const request = vi.hoisted(() => vi.fn());
vi.mock('../../api/http', async (orig) => ({
  ...(await orig<object>()),
  request,
}));

const ev = (score: number, extra = {}) => ({
  groupId: 'g',
  runIds: ['r'],
  score,
  costUsd: 0.5,
  ...extra,
});
const commit = (hash: string, message: string, e?: object, extra = {}) => ({
  hash,
  date: '2026-01-01',
  message,
  author: 'a',
  eval: e,
  trendable: !!e,
  ...extra,
});
let list: object;
let gate: object;

beforeEach(() => {
  list = {
    commits: [
      commit('ccc3333', 'third', ev(0.5, { dirty: true }), { delta: -0.25 }),
      commit('bbb2222', 'second', ev(0.75), { delta: 0.25 }),
      commit('aaa1111', 'first', ev(0.5)),
    ],
  };
  gate = {
    status: 'fail',
    rules: [
      {
        id: 'no-regression',
        status: 'fail',
        message: 'one case regressed',
        cases: ['c1'],
      },
      { id: 'ctx-not-grown', status: 'pass', message: 'ok' },
      { id: 'holdout-pass', status: 'unknown', message: 'no holdout cases' },
    ],
    warnings: ['to: run on a dirty tree'],
    suite: { cases: 2, mean: 0.12, ci: [-0.05, 0.3], verdict: 'inconclusive' },
  };
  request.mockReset().mockImplementation(async (_m: string, url: string) => {
    if (url.includes('/versions/compare'))
      return {
        files: [{ status: 'M', path: 'skills/x/SKILL.md' }],
        suite: {
          cases: 2,
          mean: 0.12,
          ci: [-0.05, 0.3],
          verdict: 'inconclusive',
        },
        cases: [
          {
            name: 'c1',
            from: { runId: 'rf', arm: 'with', n: 2, score: 1, costUsd: 0.1 },
            to: { runId: 'rt', arm: 'with', n: 3, score: 0.5, costUsd: 0.2 },
            delta: -0.5,
          },
        ],
      };
    if (url.includes('/versions/gate')) return gate;
    if (url.includes('/versions/diff'))
      return { path: 'skills/x/SKILL.md', old: 'a', new: 'b' };
    return list;
  });
});

function renderWidget() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <VersionsWidget spaceId="s" />
      </MantineProvider>
    </QueryClientProvider>,
  );
}
const compareUrl = () =>
  request.mock.calls
    .map((c) => c[1] as string)
    .filter((u) => u.includes('/versions/compare'))
    .at(-1);

describe('VersionsWidget', () => {
  it('lists commits with score delta and a warning for dirty runs; compares the last two by default', async () => {
    renderWidget();
    expect(await screen.findByText('third')).toBeTruthy();
    expect(screen.getByText('-0.25')).toBeTruthy();
    expect(screen.getByLabelText(/warning: run on a dirty tree/)).toBeTruthy();
    await screen.findByText('c1');
    for (const h of ['Case', 'Score', 'Δ', 'Cost', 'Traces'])
      expect(screen.getByText(h)).toBeTruthy();
    expect(screen.getByText('1.00 → 0.50')).toBeTruthy();
    expect(compareUrl()).toContain('from=bbb2222&to=ccc3333');
    expect(screen.getByTestId('point-aaa1111')).toBeTruthy();
  });

  it('keeps its own compare columns when another compare table saved a choice', async () => {
    updatePrefs('default', () => ({
      columns: { compare: ['score'], 'compare-experiments': ['score'] },
    }));
    renderWidget();
    await screen.findByText('c1');
    expect(screen.getByText('Traces')).toBeTruthy();
    expect(screen.getByText('Cost')).toBeTruthy();
    updatePrefs('default', () => ({ columns: {} }));
  });

  it('selecting two other commits shows their compare', async () => {
    renderWidget();
    await screen.findByText('c1');
    fireEvent.click(screen.getByText('first')); // a third click replaces the earlier pick
    await waitFor(() =>
      expect(compareUrl()).toContain('from=aaa1111&to=bbb2222'),
    );
    fireEvent.click(await screen.findByLabelText('to trace c1'));
    expect(await screen.findByText('rt/c1/with/3')).toBeTruthy();
    expect(screen.getByText('+0.12 [-0.05, +0.30]')).toBeTruthy();
    expect(screen.getByLabelText('suite verdict')).toHaveProperty(
      'textContent',
      'inconclusive',
    );
  });

  it('shows gate verdicts and warnings', async () => {
    renderWidget();
    fireEvent.click(await screen.findByRole('tab', { name: 'Gate' }));
    expect(await screen.findByText(/one case regressed/)).toBeTruthy();
    expect(screen.getByText('unknown')).toBeTruthy();
    expect(screen.getByText('pass')).toBeTruthy();
    expect(screen.getByText('to: run on a dirty tree')).toBeTruthy();
    expect(screen.getByText('gate: fail')).toBeTruthy();
  });

  it('lists changed files and opens the commit-to-commit diff of one', async () => {
    renderWidget();
    fireEvent.click(await screen.findByRole('tab', { name: /Files/ }));
    fireEvent.click(await screen.findByText('skills/x/SKILL.md'));
    expect(await screen.findByTestId('diff')).toHaveProperty(
      'textContent',
      'bbb2222/skills/x/SKILL.md ccc3333/skills/x/SKILL.md',
    );
    expect(request.mock.calls.map((c) => c[1] as string)).toContain(
      '/api/spaces/s/versions/diff?from=bbb2222&to=ccc3333&path=skills%2Fx%2FSKILL.md',
    );
  });

  it('empty state without evals', async () => {
    list = { commits: [commit('aaa1111', 'first')] };
    renderWidget();
    expect(await screen.findByText(/No eval runs mapped/)).toBeTruthy();
  });

  it('shows the error of a non-repo space', async () => {
    request.mockRejectedValue(new Error('not a git repository'));
    renderWidget();
    expect(await screen.findByText('not a git repository')).toBeTruthy();
  });
});
