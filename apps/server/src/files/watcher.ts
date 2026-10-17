import { basename, relative, sep } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { FsEvent } from '@pm/protocol';
import type { Registry } from '../spaces/registry';
import type { Hub } from '../ws/hub';
import { IGNORED } from './service';

const FS_EVENTS: string[] = ['add', 'change', 'unlink', 'addDir', 'unlinkDir'];

/** One chokidar watcher per space: started on first subscription, closed when nobody listens. */
export function watchSpaces(hub: Hub, registry: Registry) {
  // promises, so onIdle can close a watcher that is still being created
  const watchers = new Map<string, Promise<FSWatcher>>();

  hub.onSubscribe(async (spaceId) => {
    if (watchers.has(spaceId)) return;
    const created = registry.get(spaceId).then(({ path: root }) => {
      const watcher = watch(root, {
        ignored: (p) => IGNORED.includes(basename(p)),
        ignoreInitial: true,
      });
      watcher.on('all', (event, path) => {
        if (!FS_EVENTS.includes(event)) return;
        hub.broadcast(spaceId, {
          type: 'fs.changed',
          spaceId,
          event: event as FsEvent,
          path: relative(root, path).split(sep).join('/'),
        });
      });
      return watcher;
    });
    watchers.set(spaceId, created);
    try {
      await created;
    } catch (e) {
      watchers.delete(spaceId);
      throw e;
    }
  });

  hub.onIdle((spaceId) => {
    const created = watchers.get(spaceId);
    watchers.delete(spaceId);
    void created?.then(
      (w) => w.close(),
      () => undefined,
    );
  });

  return {
    close: async () => {
      await Promise.all(
        [...watchers.values()].map((created) => created.then((w) => w.close())),
      );
      watchers.clear();
    },
  };
}
