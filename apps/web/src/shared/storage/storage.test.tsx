import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPersistentStore, storage, usePersistentFlag } from './index';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const blocked = () =>
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });

describe('storage', () => {
  it('reads and writes, and never throws', () => {
    expect(storage.get('k')).toBeNull();
    expect(storage.set('k', 'v')).toBe(true);
    expect(storage.get('k')).toBe('v');
    storage.remove('k');
    expect(storage.get('k')).toBeNull();
    blocked();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(storage.get('k')).toBeNull();
    expect(storage.tryGet('k')).toBeUndefined();
    expect(storage.set('k', 'v')).toBe(false);
  });
});

describe('usePersistentFlag', () => {
  it('starts from the stored value, else the fallback, and remembers changes under the same key', () => {
    localStorage.setItem('flag', '1');
    const a = renderHook(() => usePersistentFlag('flag'));
    expect(a.result.current[0]).toBe(true);
    act(() => a.result.current[1](false));
    expect(localStorage.getItem('flag')).toBe('0');
    const b = renderHook(() => usePersistentFlag('other', () => true));
    expect(b.result.current[0]).toBe(true);
    act(() => b.result.current[1](false));
    expect(localStorage.getItem('other')).toBe('0');
  });

  it('works with blocked storage', () => {
    blocked();
    const a = renderHook(() => usePersistentFlag('flag', true));
    expect(a.result.current[0]).toBe(true);
  });
});

describe('createPersistentStore', () => {
  const make = () =>
    createPersistentStore<{ n: number }>({
      key: (scope) => `test.${scope}`,
      parse: (raw) => ({ n: raw === null ? 0 : Number(JSON.parse(raw).n) }),
    });

  it('gives a stable snapshot, notifies on writes and persists per scope', () => {
    const s = make();
    const first = s.read('a');
    expect(s.read('a')).toBe(first);
    const seen = vi.fn();
    const off = s.subscribe(seen);
    s.write('a', { n: 2 });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(s.read('a')).toEqual({ n: 2 });
    expect(localStorage.getItem('test.a')).toBe('{"n":2}');
    expect(s.read('b')).toEqual({ n: 0 });
    off();
  });

  it('keeps the value in memory while storage is unavailable', () => {
    const s = make();
    s.write('m', { n: 5 });
    blocked();
    expect(s.read('m')).toEqual({ n: 5 });
  });
});
