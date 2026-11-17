import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIVE_REFETCH_MS, useLiveRefetch } from './hooks';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = () => {
  const refetch = vi.fn();
  const hook = renderHook(
    (p: { tick: number; running: boolean }) => useLiveRefetch(refetch, p),
    { initialProps: { tick: 0, running: true } },
  );
  return { refetch, rerender: hook.rerender, unmount: hook.unmount };
};

it('refetches on new events at most once per window, plus once when the turn goes idle', () => {
  const { refetch, rerender } = setup();
  expect(refetch).not.toHaveBeenCalled(); // mount: the query fetches by itself
  rerender({ tick: 1, running: true });
  rerender({ tick: 2, running: true });
  rerender({ tick: 3, running: true });
  expect(refetch).not.toHaveBeenCalled(); // inside the first window: one call scheduled
  vi.advanceTimersByTime(LIVE_REFETCH_MS);
  expect(refetch).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(LIVE_REFETCH_MS);
  rerender({ tick: 4, running: true });
  expect(refetch).toHaveBeenCalledTimes(2); // the window had passed: right away
  rerender({ tick: 5, running: true });
  rerender({ tick: 5, running: false });
  expect(refetch).toHaveBeenCalledTimes(3); // final refetch on idle replaces the scheduled one
  vi.advanceTimersByTime(LIVE_REFETCH_MS * 2);
  expect(refetch).toHaveBeenCalledTimes(3);
});

it('does nothing while idle and clears its timer on unmount', () => {
  const { refetch, rerender, unmount } = setup();
  rerender({ tick: 1, running: true });
  unmount();
  vi.advanceTimersByTime(LIVE_REFETCH_MS * 2);
  expect(refetch).not.toHaveBeenCalled();
  const idle = vi.fn();
  const h = renderHook(
    (p: { tick: number }) =>
      useLiveRefetch(idle, { tick: p.tick, running: false }),
    { initialProps: { tick: 0 } },
  );
  h.rerender({ tick: 1 });
  vi.advanceTimersByTime(LIVE_REFETCH_MS * 2);
  expect(idle).not.toHaveBeenCalled();
});
