import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { RunForm } from './EvalRunPanel';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../api/http', async (orig) => ({ ...(await orig<object>()), request }));

describe('RunForm', () => {
  it('submits the cost limit (default 1) and the filters', async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(
      <MantineProvider>
        <RunForm opened onClose={() => undefined} onRun={onRun} error={null} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => expect(onRun).toHaveBeenCalledWith({ maxCostUsd: 1 }));
  });

  it('offers suite cases, tags and models, and submits the selection', async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    const suite = {
      cases: [
        { name: 'alpha', dir: 'evals/alpha', tags: ['smoke'] },
        { name: 'beta', dir: 'evals/beta', tags: [] },
      ],
      tags: ['smoke'],
    };
    render(
      <MantineProvider>
        <RunForm
          opened
          onClose={() => undefined}
          onRun={onRun}
          error={null}
          suite={suite}
          models={['haiku', 'sonnet', 'claude-x']}
        />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Cases' }));
    expect(await screen.findByRole('option', { name: 'alpha' })).toBeTruthy();
    fireEvent.click(screen.getByText('beta'));
    fireEvent.click(screen.getByRole('combobox', { name: 'Tags' }));
    fireEvent.click(await screen.findByText('smoke'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Model' }), {
      target: { value: 'my-custom-model' },
    });
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() =>
      expect(onRun).toHaveBeenCalledWith({
        maxCostUsd: 1,
        cases: ['beta'],
        tags: ['smoke'],
        model: 'my-custom-model',
      }),
    );
  });

  it('sends ablation only when the baseline box is checked', async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(
      <MantineProvider>
        <RunForm opened onClose={() => undefined} onRun={onRun} error={null} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByLabelText('Compare with a no-plugin baseline (about 2x cost)'));
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() =>
      expect(onRun).toHaveBeenCalledWith({ maxCostUsd: 1, ablation: true }),
    );
  });

  it('sends scaffold only when its box is checked', async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(
      <MantineProvider>
        <RunForm opened onClose={() => undefined} onRun={onRun} error={null} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByLabelText('Run scaffold scripts'));
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => expect(onRun).toHaveBeenCalledWith({ maxCostUsd: 1, scaffold: true }));
  });
});

describe('RunForm trust checkbox', () => {
  const renderForm = (evalTrusted: boolean) => {
    request.mockReset().mockImplementation(async (method: string, url: string) =>
      method === 'GET' ? { evalTrusted } : { trusted: true, url },
    );
    const onRun = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MantineProvider>
          <RunForm opened onClose={() => undefined} onRun={onRun} error={null} spaceId="s1" />
        </MantineProvider>
      </QueryClientProvider>,
    );
    return onRun;
  };
  it('trusts without starting a run', async () => {
    const onRun = renderForm(false);
    fireEvent.click(await screen.findByLabelText('Trust this plugin'));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('PUT', '/api/spaces/s1/evals/trust', { trusted: true }),
    );
    expect(onRun).not.toHaveBeenCalled();
  });

  it('is hidden when the plugin is trusted', async () => {
    renderForm(true);
    await waitFor(() => expect(request).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50)); // let the config query settle
    expect(screen.queryByLabelText('Trust this plugin')).toBeNull();
  });
});
