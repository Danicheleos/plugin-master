import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModeSelect } from './ModeSelect';

describe('ModeSelect', () => {
  it('shows the mode and reports a change', () => {
    const onChange = vi.fn();
    render(
      <MantineProvider>
        <ModeSelect mode="plan" onChange={onChange} />
      </MantineProvider>,
    );
    expect(screen.getByDisplayValue('Plan')).toBeTruthy();
    fireEvent.click(screen.getByDisplayValue('Plan'));
    fireEvent.click(screen.getByText('Accept edits'));
    expect(onChange).toHaveBeenCalledWith('acceptEdits');
  });
});
