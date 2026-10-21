import { basename, relative, sep } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { FsEvent } from '@pm/protocol';
import type { Registry } from '../spaces/registry';
import type { Client, Hub } from '../ws/hub';
import { IGNORED } from './service';
import { resolveInSpace } from './safe-path';

const FS_EVENTS: string[] = ['add', 'change', 'unlink', 'addDir', 'unlinkDir'];
// always watched, so config edits show up even when the UI has not asked for them
const ALWAYS = ['.plugin-master'];

type Active = { watcher: FSWatcher; watched: Set<string> };

/**
 * Watches only what clients ask for (`fs.watch`: open files and expanded dirs, non-recursive).
 * A space's watcher exists while at least one client has a non-empty set.
 * Watcher errors (e.g. EMFILE) go to `onError` and never crash the process.
 */
export function watchSpaces(
  hub: Hub,
  registry: Registry,
  onError: (e: unknown) => void = () => undefined,
) {
  const wanted = new Map<string, Map<Client, string[]>>(); // space -> client -> relative paths
  const active = new Map<string, Active>();
  let queue: Promise<unknown> = Promise.resolve(); // applies changes one at a time
  const enqueue = (fn: () => Promise<void>) =>
    (queue = queue.then(fn).catch(onError));

  async function apply(spaceId: string) {
    const { path: root } = await registry.get(spaceId);
    const rels = new Set<string>();
    for (const paths of wanted.get(spaceId)?.values() ?? [])
      paths.forEach((p) => rels.add(p));
    const desired = new Set(
      rels.size ? [...rels, ...ALWAYS].map((p) => resolveInSpace(root, p)) : [],
    );
    let cur = active.get(spaceId);
    if (!desired.size) {
      active.delete(spaceId);
      await cur?.watcher.close();
      return;
    }
    // chokidar's unwatch() leaves the path ignored (hiding its add/unlink events in the
    // parent listing), so a shrinking set restarts the watcher instead
    if (cur && [...cur.watched].some((p) => !desired.has(p))) {
      active.delete(spaceId);
      await cur.watcher.close();
      cur = undefined;
    }
    if (!cur) {
      const watcher = watch([], {
        depth: 0,
        ignored: (p) => IGNORED.includes(basename(p)),
        ignoreInitial: true,
      });
      watcher.on('error', onError);
      watcher.on('all', (event, path) => {
        if (!FS_EVENTS.includes(event)) return;
        // a requested path that did not exist when added is only picked up by adding it again
        if (event === 'addDir' && active.get(spaceId)?.watched.has(path))
          watcher.add(path);
        hub.broadcast(spaceId, {
          type: 'fs.changed',
          spaceId,
          event: event as FsEvent,
          path: relative(root, path).split(sep).join('/'),
        });
      });
      cur = { watcher, watched: new Set() };
      active.set(spaceId, cur);
    }
    for (const p of desired)
      if (!cur.watched.has(p)) {
        cur.watcher.add(p);
        cur.watched.add(p);
      }
  }

  const set = (spaceId: string, client: Client, paths: string[]) => {
    const clients = wanted.get(spaceId) ?? new Map<Client, string[]>();
    if (paths.length) clients.set(client, paths);
    else clients.delete(client);
    if (clients.size) wanted.set(spaceId, clients);
    else wanted.delete(spaceId);
    return enqueue(() => apply(spaceId));
  };

  hub.on('fs.watch', async ({ spaceId, paths }, client) => {
    const { path: root } = await registry.get(spaceId);
    paths.forEach((p) => resolveInSpace(root, p)); // rejects the whole message on an invalid path
    await set(spaceId, client, paths);
  });

  hub.onLeave((spaceId, client) => {
    if (wanted.get(spaceId)?.has(client)) void set(spaceId, client, []);
  });

  return {
    close: async () => {
      await queue;
      const all = [...active.values()];
      active.clear();
      wanted.clear();
      await Promise.all(all.map((a) => a.watcher.close().catch(onError)));
    },
  };
}
