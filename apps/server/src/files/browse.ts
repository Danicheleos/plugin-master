import { readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { BrowseResult } from '@pm/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../lib/errors';

/** Lists subdirectories of an absolute path (default `defaultDir`) for the folder picker. */
export const browseRoutes =
  (defaultDir: string): FastifyPluginAsync =>
  async (app) => {
    app.get<{ Querystring: { path?: string } }>(
      '/fs/browse',
      async (req): Promise<BrowseResult> => {
        const raw = req.query.path || defaultDir;
        if (typeof raw !== 'string' || !isAbsolute(raw) || raw.includes('\0'))
          throw new AppError('BAD_PATH', 'Path must be absolute', 400);
        const path = resolve(raw);
        const isDir = await stat(path).then(
          (s) => s.isDirectory(),
          () => false,
        );
        if (!isDir) throw new AppError('NOT_FOUND', 'Not a directory', 404);
        const dirents = await readdir(path, { withFileTypes: true }).catch(
          () => {
            throw new AppError('NOT_FOUND', 'Cannot read directory', 404);
          },
        );
        const entries = await Promise.all(
          dirents
            .filter((d) => !d.name.startsWith('.'))
            .map(async (d) =>
              d.isDirectory() ||
              (d.isSymbolicLink() &&
                (await stat(resolve(path, d.name)).then(
                  (s) => s.isDirectory(),
                  () => false,
                )))
                ? { name: d.name }
                : null,
            ),
        );
        const parent = dirname(path);
        return {
          path,
          parent: parent === path ? null : parent,
          entries: entries
            .filter((e) => e !== null)
            .sort((a, b) => a.name.localeCompare(b.name)),
        };
      },
    );
  };
