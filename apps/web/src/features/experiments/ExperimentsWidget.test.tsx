import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import { ExperimentsWidget } from './ExperimentsWidget';

vi.mock('../../api/ws', () => ({ useSpaceEvents: vi.fn(), send: vi.fn() }));
vi.mock('@monaco-editor/react', () => ({ DiffEditor: () => <div data-testid="diff" /> }));
const request = vi.hoisted(() => vi.fn());
vi.mock('../../api/http', async (orig) => ({ ...(await orig<object>()), request }));

const base = {
  branch: 'exp/1',
  base: 'a'.repeat(40),
  worktree: '/w',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const running = { ...base, id: 1, status: 'running', stage: 'execute' };
const ready = {
  ...base,
  id: 2,
  branch: 'exp/2',
  status: 'ready',
  costUsd: 1.5,
  plan: { title: 'Shorter prompt', rationale: 'Because', expectedEffect: [], files: [] },
  comparison: { baseline: { runId: 'r' }, cases: [{ case: 'c1', score: 1, baselineScore: 0.5 }] },
  analysis: { verdict: 'improve', reasons: ['faster'], cases: [], recommendation: 'merge' },
  stateProposal: 'Keep the short prompt',
};
let list: object[];
let ledger: object[];
let failMerge: Error | null;

beforeEach(() => {
  list = [running, ready];
  ledger = [];
  failMerge = null;
  request.mockReset().mockImplementation(async (method: string, url: string) => {
    if (url.endsWith('/experiments/ledger')) return ledger;
    if (url.endsWith('/evals/suite')) return { cases: [{ name: 'c1', dir: 'evals/c1', tags: [] }], tags: [] };
    if (method === 'POST' && url.endsWith('/merge') && failMerge) throw failMerge;
    if (method === 'POST') return {};
    if (url.endsWith('/diff')) return { files: [] };
    const m = /experiments\/(\d+)$/.exec(url);
    if (m) return list.find((e) => (e as { id: number }).id === Number(m[1]));
    return list;
  });
});

function renderWidget() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <ExperimentsWidget spaceId="s" />
      </MantineProvider>
    </QueryClientProvider>,
  );
}
const post = (end: string) => request.mock.calls.find((c) => c[0] === 'POST' && (c[1] as string).endsWith(end));

describe('ExperimentsWidget', () => {
  it('validates the cost and posts the run body', async () => {
    renderWidget();
    const cost = screen.getByLabelText('Max cost (USD)');
    fireEvent.change(cost, { target: { value: '25' } });
    fireEvent.click(screen.getByText('Run experiment'));
    expect(post('/run')).toBeUndefined();
    expect(screen.getByText('Enter 0 to 20')).toBeTruthy();
    fireEvent.change(cost, { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Focus (optional)'), { target: { value: ' tighter ' } });
    fireEvent.click(screen.getByText('Run experiment'));
    await waitFor(() => expect(post('/run')).toBeTruthy());
    expect(post('/run')![2]).toEqual({ maxCostUsd: 3, focus: 'tighter' });
  });

  it('posts scaffold when ticked', async () => {
    renderWidget();
    fireEvent.click(screen.getByLabelText('Run scaffold scripts'));
    fireEvent.click(screen.getByText('Run experiment'));
    await waitFor(() => expect(post('/run')).toBeTruthy());
    expect(post('/run')![2]).toEqual({ maxCostUsd: 2, scaffold: true });
  });

  it('shows a hint for an untrusted plugin', async () => {
    request.mockImplementation(async (method: string, url: string) => {
      if (method === 'POST') throw new ApiError('EVAL_UNTRUSTED', 'Confirm first', 409);
      return url.endsWith('/suite') ? { cases: [], tags: [] } : [];
    });
    renderWidget();
    fireEvent.click(screen.getByText('Run experiment'));
    expect(await screen.findByText(/Confirm first Tick "Trust this plugin" in the form first/)).toBeTruthy();
  });

  it('cancels a running experiment', async () => {
    renderWidget();
    fireEvent.click(await screen.findByText('execute'));
    fireEvent.click(await screen.findByText('Cancel'));
    await waitFor(() => expect(post('/1/cancel')).toBeTruthy());
  });

  it('shows the result of a ready experiment; merge needs a confirm and shows a conflict', async () => {
    failMerge = new ApiError('GIT_CONFLICT', 'Merge conflict in: a.md', 409);
    renderWidget();
    fireEvent.click(await screen.findByText('Shorter prompt'));
    expect(await screen.findByText('Hypothesis: Shorter prompt')).toBeTruthy();
    expect(screen.getByText('+0.50')).toBeTruthy();
    expect(screen.getByText('faster')).toBeTruthy();
    expect(screen.getByText('Keep the short prompt')).toBeTruthy();
    fireEvent.click(screen.getByText('Merge'));
    expect(await screen.findByText(/merges exp\/2 into the current branch/i)).toBeTruthy();
    expect(post('/2/merge')).toBeUndefined();
    fireEvent.click(screen.getAllByText('Merge').find((b) => (b as unknown as { closest(s: string): unknown }).closest('.mantine-Modal-content'))!);
    expect(await screen.findByText('Merge conflict in: a.md')).toBeTruthy();
    expect(post('/2/merge')).toBeTruthy();
  });

  it('renders a description experiment: candidates, original vs best, verdict, accept and reject', async () => {
    list = [
      {
        ...base,
        id: 3,
        branch: 'exp/3',
        status: 'ready',
        kind: 'description',
        skill: 'demo',
        trainCases: ['t1', 't2'],
        holdoutCases: ['h1'],
        candidates: [
          { text: 'Old text', train: 0.5, holdout: 0.5, costUsd: 0.1 },
          { text: 'Better text', train: 1, holdout: 0.75, costUsd: 0.2 },
        ],
        descriptionResult: { bestIndex: 1, verdict: 'pass' },
        stages: { propose: { startedAt: 'x', endedAt: 'y' } },
      },
    ];
    renderWidget();
    fireEvent.click(await screen.findByText('Description: demo'));
    expect(await screen.findByText('2 train / 1 holdout cases')).toBeTruthy();
    expect(screen.getByLabelText('verdict')).toBeTruthy();
    expect(screen.getByText('pass')).toBeTruthy();
    expect(screen.getByText('Better text')).toBeTruthy();
    expect(screen.getByText('0.75')).toBeTruthy();
    expect(screen.getByText('- Old text', { exact: false })).toBeTruthy();
    expect(screen.getByText('+ Better text')).toBeTruthy();
    expect(screen.queryByText('hypothesis')).toBeNull(); // loop stages are not shown for this kind
    expect(screen.getByText('propose')).toBeTruthy();
    fireEvent.click(screen.getByText('Accept (merge)'));
    fireEvent.click(screen.getAllByText('Merge').find((b) => (b as unknown as { closest(s: string): unknown }).closest('.mantine-Modal-content'))!);
    await waitFor(() => expect(post('/3/merge')).toBeTruthy());
    expect(screen.getByText('Reject (discard)')).toBeTruthy();
  });

  it('shows the unknown verdict warning', async () => {
    list = [
      {
        ...base, id: 4, branch: 'exp/4', status: 'ready', kind: 'description', skill: 'demo',
        candidates: [{ text: 'Old', train: 0.5, costUsd: 0 }],
        descriptionResult: { bestIndex: 0, verdict: 'unknown', warning: 'no holdout cases' },
      },
    ];
    renderWidget();
    fireEvent.click(await screen.findByText('Description: demo'));
    expect(await screen.findByText('no holdout cases')).toBeTruthy();
    expect(screen.getByLabelText('verdict')).toBeTruthy();
    expect(screen.getByText('unknown')).toBeTruthy();
  });
  it('lists ledger records with verdict, merged state and lesson', async () => {
    ledger = [{
      id: 'l1', at: '2026-02-03T00:00:00Z', experiment: 2, kind: 'hypothesis', skills: ['demo'], files: [],
      changeType: 'instructions', hypothesis: 'Shorten intro', diffSummary: '', diffStat: { files: 1, additions: 1, deletions: 0 },
      base: 'a', evalRunIds: [], cases: [], merged: false, lesson: 'Shorter intros lose context', costUsd: 1,
      suite: { cases: 4, mean: -0.2, ci: [-0.3, -0.1], verdict: 'regressed' },
    }];
    renderWidget();
    expect(await screen.findByText('Shorten intro')).toBeTruthy();
    expect(screen.getByText('Shorter intros lose context')).toBeTruthy();
    expect(screen.getByText('regressed')).toBeTruthy();
    expect(screen.getByText('discarded')).toBeTruthy();
    expect(screen.getByText('instructions')).toBeTruthy();
  });
});
