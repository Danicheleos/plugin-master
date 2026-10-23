import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ExternalSeriesSchema, type ExternalSeries } from '@pm/protocol';
import { resultsRoot } from './results';
import { resolveInSpace } from '../files/safe-path';

export const EXTERNAL_FILE = 'running.json';
/** A finished series stays visible this long so the last state is seen. */
export const FINISHED_TTL_MS = 2 * 60_000;
/** Series are driven by separate commands with gaps, so there is no pid check: only a long silence marks one as dead. */
export const STALE_MS = 30 * 60_000;

/** The live external series of the space, or null: file missing/invalid, finished long ago, or stale. */
export async function readExternalSeries(
  root: string,
  now = Date.now(),
): Promise<ExternalSeries | null> {
  try {
    const file = resolveInSpace(root, relative(root, join(await resultsRoot(root), EXTERNAL_FILE)));
    const parsed = ExternalSeriesSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
    if (!parsed.success) return null;
    const s = parsed.data;
    const updated = Date.parse(s.updatedAt);
    if (Number.isNaN(updated) || now - updated > STALE_MS) return null;
    if (s.finishedAt !== null) {
      const finished = Date.parse(s.finishedAt);
      if (Number.isNaN(finished) || now - finished > FINISHED_TTL_MS) return null;
    }
    return s;
  } catch {
    return null;
  }
}
