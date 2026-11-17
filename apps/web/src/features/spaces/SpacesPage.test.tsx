import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpacesPage } from './SpacesPage';

const mutate = vi.hoisted(() => vi.fn());
vi.mock('./hooks', () => ({
  useSpaces: () => ({
    data: [{ id: 's1', name: 'alpha', path: '/p/alpha' }],
    error: null,
    isPending: false,
  }),
  useRemoveSpace: () => ({ mutate, error: null, reset: vi.fn() }),
}));
vi.mock('../runs/OpenTraceFile', () => ({ OpenTraceFile: () => null }));
vi.mock('../theme/ColorSchemeToggle', () => ({
  ColorSchemeToggle: () => null,
}));

const view = () =>
  render(
    <MantineProvider>
      <MemoryRouter>
        <SpacesPage />
      </MemoryRouter>
    </MantineProvider>,
  );

describe('SpacesPage remove', () => {
  beforeEach(() => mutate.mockReset());

  it('asks before removing and removes only on confirm', async () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Remove from list' }));
    expect(
      await screen.findByText(
        'Remove alpha from the list? The folder is not deleted.',
      ),
    ).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith('s1'));
  });

  it('cancel keeps the space', async () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Remove from list' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(mutate).not.toHaveBeenCalled();
  });
});
