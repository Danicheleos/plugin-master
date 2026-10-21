import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ContextMeter } from './AgentStats';

it('falls back to the window when auto-compact is off', () => {
  render(
    <MantineProvider>
      <ContextMeter
        usage={{ tokens: 50000, max: 200000, percent: 25, limit: null }}
      />
    </MantineProvider>,
  );
  expect(screen.getByText('Context 50k / 200k · 150k left')).toBeTruthy();
});
