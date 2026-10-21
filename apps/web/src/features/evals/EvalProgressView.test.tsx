import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BuildSuiteDialog } from './BuildSuiteDialog';
import { EvalProgressView } from './EvalProgressView';

describe('EvalProgressView', () => {
  it('shows N of M cases, states and scores', () => {
    render(
      <MantineProvider>
        <EvalProgressView
          progress={{
            total: 3,
            done: 1,
            current: 'b',
            cases: [
              { name: 'alpha', state: 'done', score: 0.5 },
              { name: 'beta', state: 'running' },
              { name: 'gamma', state: 'queued' },
            ],
          }}
        />
      </MantineProvider>,
    );
    expect(screen.getByText('1 of 3 cases')).toBeTruthy();
    expect(screen.getByText('0.50')).toBeTruthy();
    expect(screen.getByText('beta')).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
    expect(screen.getByText('queued')).toBeTruthy();
  });
});

describe('BuildSuiteDialog', () => {
  it('sends only on confirm and focuses Cancel', async () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    render(
      <MantineProvider>
        <BuildSuiteDialog opened prompt="PROMPT TEXT" onCancel={onCancel} onSend={onSend} />
      </MantineProvider>,
    );
    expect(screen.getByText('PROMPT TEXT')).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await vi.waitFor(() => expect((globalThis as unknown as { document: { activeElement: unknown } }).document.activeElement).toBe(cancel));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Send to agent'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
