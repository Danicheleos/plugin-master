import { useCallback, useState, useSyncExternalStore } from 'react';

/**
 * localStorage that never throws (blocked, private mode, quota): reads give `null`/`undefined`,
 * writes report failure. Keys are the app's stable `pm.*` names, so stored user data keeps working.
 */
export const storage = {
  /** The stored string, `null` when absent or when storage is unavailable. */
  get(key: string): string | null {
    return storage.tryGet(key) ?? null;
  },
  /** Like `get`, but `undefined` when storage is unavailable (to tell it from "absent"). */
  tryGet(key: string): string | null | undefined {
    try {
      return localStorage.getItem(key);
    } catch {
      return undefined;
    }
  },
  /** False when the value could not be stored. */
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // nothing stored anyway
    }
  },
};

/** A stored "1"/"0" flag, `undefined` when absent or unavailable. */
export function readFlag(key: string): boolean | undefined {
  const v = storage.get(key);
  return v === '1' ? true : v === '0' ? false : undefined;
}

export const writeFlag = (key: string, value: boolean) =>
  storage.set(key, value ? '1' : '0');

/**
 * A boolean state remembered in storage as "1"/"0". `fallback` (a value or a function, evaluated
 * once) applies while nothing is stored.
 */
export function usePersistentFlag(
  key: string,
  fallback: boolean | (() => boolean) = false,
) {
  const [value, setValue] = useState(
    () =>
      readFlag(key) ?? (typeof fallback === 'function' ? fallback() : fallback),
  );
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      writeFlag(key, v);
    },
    [key],
  );
  return [value, set] as const;
}

/**
 * A module-level store persisted in storage, one entry per `scope`, for `useSyncExternalStore`.
 * `read` gives the same object until the stored string (or a write) changes; when storage is
 * unavailable the last written value lives in memory only.
 */
export function createPersistentStore<T>({
  key,
  parse,
  serialize = JSON.stringify,
  crossTab = false,
}: {
  /** storage key of a scope */
  key: (scope: string) => string;
  /** the stored string (null = none) to a value; must not throw */
  parse: (raw: string | null) => T;
  serialize?: (value: T) => string;
  /** also notify on `storage` events (other browser tabs) */
  crossTab?: boolean;
}) {
  const entries = new Map<string, { raw: string | null; value: T }>();
  const listeners = new Set<() => void>();

  const read = (scope = ''): T => {
    const known = entries.get(scope);
    const stored = storage.tryGet(key(scope));
    const raw = stored === undefined ? (known?.raw ?? null) : stored;
    if (known && known.raw === raw) return known.value;
    const value = parse(raw);
    entries.set(scope, { raw, value });
    return value;
  };

  const write = (scope: string, value: T) => {
    const raw = serialize(value);
    entries.set(scope, { raw, value });
    storage.set(key(scope), raw);
    listeners.forEach((l) => l());
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (crossTab) window.addEventListener('storage', listener);
    return () => {
      listeners.delete(listener);
      if (crossTab) window.removeEventListener('storage', listener);
    };
  };

  /** Re-renders when `select`'s result changes (a primitive or a stable reference). */
  const useSelect = <S>(scope: string, select: (value: T) => S): S =>
    useSyncExternalStore(subscribe, () => select(read(scope)));

  return { read, write, subscribe, useSelect };
}
