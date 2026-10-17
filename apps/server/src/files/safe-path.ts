import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { AppError } from '../lib/errors';

const outside = () =>
  new AppError('PATH_OUTSIDE_SPACE', 'Path escapes space', 400);

/** realpath of the deepest existing ancestor, plus the not-yet-existing tail. */
function realDeepest(p: string): string {
  try {
    return realpathSync(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    // a dangling symlink could be written through to anywhere
    if (lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink())
      throw outside();
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(realDeepest(parent), path.basename(p));
  }
}

/**
 * The only place that turns a user-supplied relative path into an absolute one inside a space.
 * Checks both the lexical path and the symlink-resolved one.
 */
export function resolveInSpace(root: string, rel: string): string {
  if (rel.includes('\0')) throw outside();
  const abs = path.resolve(root, rel);
  const inside = (r: string, a: string) =>
    a === r || a.startsWith(r + path.sep);
  if (!inside(root, abs) || !inside(realDeepest(root), realDeepest(abs)))
    throw outside();
  return abs;
}
