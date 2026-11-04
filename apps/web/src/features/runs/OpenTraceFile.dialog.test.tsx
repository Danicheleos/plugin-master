import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { OpenTraceFile } from './OpenTraceFile';

vi.mock('../../api/http', async (orig) => ({
  ...(await orig<object>()),
  request: vi.fn(async () => [
    { id: 's1', title: 'T', lastModified: 1, cwd: '/p', project: 'p' },
  ]),
}));

it('opens the picker without opening the Project dropdown', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider>
        <OpenTraceFile />
      </MantineProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText('Open trace file'));
  await waitFor(() =>
    expect(screen.getAllByLabelText('Project').length).toBeGreaterThan(0),
  );
  await new Promise((r) => setTimeout(r, 300)); // past the modal's focus trap
  const project = screen.getByPlaceholderText('Search projects');
  expect(
    screen.getAllByRole('combobox', { hidden: true, expanded: false }),
  ).toContain(project);
});
