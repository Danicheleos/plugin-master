import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { QueryError } from './QueryError';

it('shows the message in red, nothing without an error', () => {
  const { rerender } = render(
    <MantineProvider>
      <QueryError error={new Error('boom')} p="md" />
    </MantineProvider>,
  );
  expect(screen.getByText('boom')).toHaveProperty('textContent', 'boom');
  rerender(
    <MantineProvider>
      <QueryError error={null} />
    </MantineProvider>,
  );
  expect(screen.queryByText('boom')).toBeNull();
});
