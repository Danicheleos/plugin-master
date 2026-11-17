import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A callback with a stable identity that always calls the latest `fn` (the ref is updated after
 * each commit, not during render). For effects and long-lived listeners that must not re-subscribe
 * when the closure changes.
 */
export function useLatestCallback<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
