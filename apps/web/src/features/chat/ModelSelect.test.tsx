import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelSelect } from './ModelSelect';

describe('ModelSelect', () => {
  it('shows the model and reports a change', () => {
    const onChange = vi.fn();
    render(
      <MantineProvider>
        <ModelSelect model="claude-opus-5-5" onChange={onChange} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByDisplayValue('Opus 5.5'));
    fireEvent.click(screen.getByText('Haiku 5.5'));
    expect(onChange).toHaveBeenCalledWith('claude-haiku-5-5');
  });
});
