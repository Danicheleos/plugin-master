import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

let broken = true;
function Bomb() {
  if (broken) throw new Error('boom');
  return <p>fine</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    broken = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows the fallback with the error and renders the children again after reset', () => {
    render(
      <ErrorBoundary
        fallback={({ error, reset }) => (
          <button onClick={reset}>failed: {error.message}</button>
        )}
      >
        <Bomb />
      </ErrorBoundary>,
    );
    broken = false;
    fireEvent.click(screen.getByText('failed: boom'));
    expect(screen.getByText('fine')).toBeTruthy();
  });

  it('resets by itself when a reset key changes', () => {
    const ui = (key: number) => (
      <ErrorBoundary resetKeys={[key]} fallback={() => <p>failed</p>}>
        <Bomb />
      </ErrorBoundary>
    );
    const { rerender } = render(ui(1));
    expect(screen.getByText('failed')).toBeTruthy();
    broken = false;
    rerender(ui(1));
    expect(screen.getByText('failed')).toBeTruthy();
    rerender(ui(2));
    expect(screen.getByText('fine')).toBeTruthy();
  });
});
