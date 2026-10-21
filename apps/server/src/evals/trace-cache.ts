import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { TraceMetrics } from '@pm/protocol';
import { withLock } from '../spaces/config-file';
import type { Retrieval } from './retrieval';

/** Bump when the entry shape or the metrics computation changes: an older file is discarded. */
const VERSION = 1;
const WRITE_DELAY_MS = 500;

/** Per trace file: the stat it was computed for, its metrics and the retrieval for one truth.json (by hash). */
type Entry = { mtimeMs: number; size: number; metrics?: TraceMetrics; truth?: string; retrieval?: Retrieval };
type Store = { file: string; entries: Record<string, Entry>; timer?: NodeJS.Timeout };

let home: string | undefined;
const stores = new Map<string, Promise<Store>>();

/** Where the disk caches live (`<home>/cache`); unset = memory only. Called once by `buildApp`. */
export function setTraceCacheHome(dir: string | undefined): void {
  home = dir;
}

/** Drops the in-memory state (the disk files stay), as after a restart. */
export function resetTraceCache(): void {
  stores.clear();
}

export const hashOf = (s: string) => createHash('sha1').update(s).digest('hex');

async function open(root: string): Promise<Store> {
  const dir = join(home as string, 'cache');
  const file = join(dir, `evals-${hashOf(await realpath(root).catch(() => root))}.json`);
  const store: Store = { file, entries: {} };
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data?.version === VERSION && data.files && typeof data.files === 'object') store.entries = data.files;
  } catch {
    /* missing or corrupt: start empty */
  }
  return store;
}

function save(store: Store): void {
  store.timer ??= setTimeout(() => {
    store.timer = undefined;
    void flushStore(store);
  }, WRITE_DELAY_MS).unref();
}

const flushStore = (store: Store) =>
  withLock(store.file, async () => {
    try {
      await mkdir(join(store.file, '..'), { recursive: true });
      const tmp = `${store.file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ version: VERSION, files: store.entries }));
      await rename(tmp, store.file);
    } catch {
      /* the cache is optional */
    }
  });

/** Writes every pending cache now (tests, shutdown). */
export async function flushTraceCache(): Promise<void> {
  for (const p of stores.values()) {
    const store = await p;
    if (store.timer) clearTimeout(store.timer);
    store.timer = undefined;
    await flushStore(store);
  }
}

/** The entry of `path` if it was computed for this mtime and size, else a fresh one (written back by `update`). */
export async function cached(
  root: string,
  path: string,
  s: { mtimeMs: number; size: number },
): Promise<{ entry: Entry; update: () => void }> {
  const none = { entry: { mtimeMs: s.mtimeMs, size: s.size }, update: () => undefined };
  if (!home) return none;
  let p = stores.get(root);
  if (!p) stores.set(root, (p = open(root)));
  const store = await p.catch(() => undefined);
  if (!store) return none;
  const key = relative(root, path);
  let entry = store.entries[key];
  if (entry?.mtimeMs !== s.mtimeMs || entry.size !== s.size) entry = { mtimeMs: s.mtimeMs, size: s.size };
  return {
    entry,
    update: () => {
      store.entries[key] = entry;
      save(store);
    },
  };
}
