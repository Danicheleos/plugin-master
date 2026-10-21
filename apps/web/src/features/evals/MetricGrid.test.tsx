import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MetricGrid } from './MetricGrid';

const runs = [
  { runId: 'r2', score: 1, costUsd: 0.4 },
  { runId: 'r1', score: 0.5, costUsd: 0.6 },
];

describe('MetricGrid', () => {
  it('draws every metric with two values and lets the user pick the charts', async () => {
    const view = <MantineProvider><MetricGrid runs={runs} /></MantineProvider>;
    const { unmount } = render(view);
    expect(screen.getByLabelText('Score')).toBeTruthy();
    expect(screen.getByLabelText('Cost')).toBeTruthy();
    fireEvent.click(screen.getByText('Charts'));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Cost' }));
    expect(screen.queryByRole('img', { name: 'Cost' })).toBeNull();
    unmount();
    render(view); // persisted
    expect(screen.queryByRole('img', { name: 'Cost' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Score' })).toBeTruthy();
  });
});
