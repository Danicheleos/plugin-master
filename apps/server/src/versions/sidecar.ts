import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PmMetaSchema, type PmMeta } from '@pm/protocol';
import { resolveInSpace } from '../files/safe-path';
import { inRepo } from '../git/service';

export const SIDECAR_FILE = 'pm-meta.json';

/**
 * Writes `<out>/pm-meta.json` for the commit `target` is at. Best effort: a non-repo, an unborn
 * HEAD or any git/fs failure means no sidecar and never fails the run. Dirty = tracked changes
 * outside `.plugin-master/` (the app's own state is rewritten constantly).
 */
export async function writeSidecar(
  target: string,
  spaceId: string,
  out: string,
  startedAt: string,
): Promise<void> {
  try {
    const meta = await inRepo(target, async (git): Promise<PmMeta> => {
      const rev = async (arg: string) => (await git.raw(['rev-parse', '--verify', arg])).trim();
      const status = await git.raw(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=no']);
      const branch = (await git.raw(['symbolic-ref', '-q', '--short', 'HEAD']).catch(() => '')).trim();
      return {
        commit: await rev('HEAD'),
        tree: await rev('HEAD^{tree}'),
        dirty: status.split('\n').some((l) => l.trim() && !l.slice(3).startsWith('.plugin-master/')),
        ...(branch && { branch }),
        spaceId,
        startedAt,
      };
    });
    await mkdir(out, { recursive: true });
    await writeFile(join(out, SIDECAR_FILE), `${JSON.stringify(meta, null, 2)}\n`);
  } catch {
    // no sidecar: the run maps to a commit by time
  }
}

/** The sidecar of eval run `id` (dir = eval dir), `undefined` when missing or invalid. */
export async function readMeta(root: string, dir: string, id: string): Promise<PmMeta | undefined> {
  try {
    const file = resolveInSpace(root, `${dir}/results/${id}/${SIDECAR_FILE}`);
    return PmMetaSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return undefined;
  }
}
