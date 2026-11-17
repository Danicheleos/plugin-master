import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

import App, { NotFound } from './app';

describe('App', () => {
  it('renders the title', () => {
    const { getByText } = render(<App />);
    expect(getByText('plugin-master')).toBeTruthy();
  });

  it('shows a way back on an unknown route', () => {
    const { getByRole } = render(
      <MantineProvider>
        <MemoryRouter>
          <NotFound />
        </MemoryRouter>
      </MantineProvider>,
    );
    expect(getByRole('link', { name: 'Back to spaces' })).toBeTruthy();
  });
});
