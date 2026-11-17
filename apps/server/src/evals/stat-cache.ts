import { stat } from 'node:fs/promises';

/**
 * Values computed from one file, reused while its mtime and size stay the same: an added run is
 * computed on first sight, a changed file again, and a deleted file is never listed again, so its
 * entry just ages out (least recently used past MAX_ENTRIES). In memory only.
 */
const MAX_ENTRIES = 2000;

type Entry = { mtimeMs: number; size: number; value: Promise<unknown> };
const entries = new Map<string, Entry>();

export async function byStat<T>(
  path: string,
  kind: string,
  compute: () => Promise<T>,
): Promise<T> {
  const s = await stat(path);
  const key = `${kind}\0${path}`;
  const hit = entries.get(key);
  entries.delete(key); // re-inserted below: Map order = least recently used first
  if (hit && hit.mtimeMs === s.mtimeMs && hit.size === s.size) {
    entries.set(key, hit);
    return hit.value as Promise<T>;
  }
  const entry: Entry = { mtimeMs: s.mtimeMs, size: s.size, value: compute() };
  entries.set(key, entry);
  // a failure is not cached: the next call reads the file again
  entry.value.catch(() => entries.get(key) === entry && entries.delete(key));
  for (const old of entries.keys()) {
    if (entries.size <= MAX_ENTRIES) break;
    entries.delete(old);
  }
  return entry.value as Promise<T>;
}

/** Forgets every entry (tests). */
export function resetStatCache(): void {
  entries.clear();
}
