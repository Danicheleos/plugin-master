import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Plan } from '@pm/protocol';
import { describe, expect, it, vi } from 'vitest';
import { PlanPanel } from './PlanPanel';
import { plansKey } from './hooks';

vi.mock('../../api/ws', () => ({ useSpaceEvents: vi.fn(), send: vi.fn() }));
const request = vi.hoisted(() => vi.fn());
vi.mock('../../api/http', async (orig) => ({
  ...(await orig<object>()),
  request,
}));

const plan = (o: Partial<Plan>): Plan => ({
  id: 'a',
  title: 'Top',
  goal: 'ship it',
  parentId: null,
  parentPhaseId: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  phases: [],
  log: [],
  ...o,
});

describe('PlanPanel', () => {
  it('shows the context meter on top, progress and the current action, no task list', () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    qc.setQueryData(plansKey('s'), {
      active: 'b',
      plans: [
        plan({}),
        plan({
          id: 'b',
          title: 'Child',
          parentId: 'a',
          parentPhaseId: 'p1',
          phases: [
            { id: 'p1', title: 'first', status: 'done' },
            { id: 'p2', title: 'second', status: 'in_progress' },
            { id: 'p3', title: 'third', status: 'pending' },
          ],
          log: [
            { at: '2026-01-01T00:00:00Z', message: 'Started phase: second' },
          ],
        }),
      ],
    });
    render(
      <QueryClientProvider client={qc}>
        <MantineProvider>
          <PlanPanel
            spaceId="s"
            onAsk={() => undefined}
            stats={{
              master: {
                tokens: 123000,
                max: 300000,
                percent: 41,
                limit: 267000,
              },
              current: 'Edit: SKILL.md',
              tasks: [
                {
                  id: 'k',
                  description: 'Research',
                  subagentType: 'Explore',
                  status: 'running',
                  tokens: 5000,
                  toolUses: 3,
                },
              ],
            }}
          />
        </MantineProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Phase 2 of 3')).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();
    expect(screen.getByText('Now: Edit: SKILL.md')).toBeTruthy();
    // meter, then plan progress, then the plan buttons (document order)
    const meter = screen.getByText(
      'Context 123k / 267k · 144k left (auto-compact)',
    );
    const progress = screen.getByText('Phase 2 of 3');
    const order = screen.getAllByText(/^(Context .*|Phase 2 of 3|New plan)$/);
    expect(order[0]).toBe(meter);
    expect(order[1]).toBe(progress);
    // collapsing the panel keeps the meter and the progress
    fireEvent.click(screen.getByText('Hide'));
    expect(screen.getByText('Show')).toBeTruthy();
    expect(screen.getByText('Phase 2 of 3')).toBe(progress);
    expect(screen.getByText(/^Context /)).toBe(meter);
    expect(screen.queryByText(/Research/)).toBeNull();
    expect(screen.getByText('Top ›')).toBeTruthy();
  });

  it('detaches the active plan', async () => {
    const qc = new QueryClient();
    qc.setQueryData(plansKey('s'), { active: 'a', plans: [plan({})] });
    request.mockResolvedValue({ active: null, plans: [plan({})] });
    render(
      <QueryClientProvider client={qc}>
        <MantineProvider>
          <PlanPanel
            spaceId="s"
            onAsk={() => undefined}
            stats={{ master: null, current: null, tasks: [] }}
          />
        </MantineProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('Detach'));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        'PUT',
        '/api/spaces/s/plans/active',
        { id: null },
        expect.anything(),
      ),
    );
    await waitFor(() => expect(screen.queryByText('Detach')).toBeNull());
  });
});
