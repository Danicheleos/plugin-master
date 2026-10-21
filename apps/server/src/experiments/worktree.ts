import { realpath, mkdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { Experiment, ExperimentDiff } from '@pm/protocol';
import { AppError } from '../lib/errors';
import { gitDiff, inRepo, locked } from '../git/service';
import { getExperiment, lockedExp, nextId, saveExperiment } from './store';

const MAX_FILES = 200;
const APP_DIR = '.plugin-master';
/** Where a space's worktrees live: outside the space, so its watcher, evals and git status stay clean. */
export const worktreesDir = (home: string, spaceId: string) => join(home, 'worktrees', spaceId);

export type Ctx = { root: string; dir: string };

const closed = (e: Experiment) =>
  new AppError('EXPERIMENT_CLOSED', `Experiment ${e.id} is ${e.status}`, 409);

/** The record's worktree path, only if it is inside the worktrees dir (a tampered record never reaches `rm`). */
async function owned({ dir }: Ctx, e: Experiment): Promise<string | null> {
  const real = await realpath(e.worktree).catch(() => null);
  if (real === null) return null; // already gone
  const base = await realpath(dir).catch(() => null);
  if (!base || !real.startsWith(base + sep))
    throw new AppError('EXPERIMENT_PATH', `Worktree of experiment ${e.id} is outside ${dir}`, 400);
  return real;
}

const touch = (e: Experiment, patch: Partial<Experiment>): Experiment => ({
  ...e,
  ...patch,
  updatedAt: new Date().toISOString(),
});

export const createExperiment = (ctx: Ctx, hypothesis?: string): Promise<Experiment> =>
  lockedExp(ctx.root, () =>
    inRepo(ctx.root, async (git) => {
      const base = (await git.raw(['rev-parse', '--verify', '-q', 'HEAD']).catch(() => '')).trim();
      if (!base) throw new AppError('NO_COMMITS', 'The repository has no commits yet', 409);
      const id = await nextId(ctx.root);
      await mkdir(ctx.dir, { recursive: true });
      // realpath: the CLI reports realpaths (e.g. /private/tmp), so cwd and tool paths agree
      const worktree = join(await realpath(ctx.dir), `exp-${id}`);
      const branch = `exp/${id}`;
      await git.raw(['worktree', 'add', '-b', branch, worktree, base]);
      const now = new Date().toISOString();
      return saveExperiment(ctx.root, {
        id, branch, base, worktree, status: 'created', createdAt: now, updatedAt: now,
        ...(hypothesis ? { hypothesis } : {}),
      });
    }),
  );

export async function diffExperiment(ctx: Ctx, n: number): Promise<ExperimentDiff> {
  const e = await getExperiment(ctx.root, n);
  const wt = await owned(ctx, e);
  if (!wt || e.status === 'merged' || e.status === 'discarded') throw closed(e);
  const names = await locked(wt, async (git) => {
    const list = (...a: string[]) => git.raw(a).then((s) => s.split('\0').filter(Boolean));
    const changed = await list('diff', '--name-only', '-z', '--no-renames', e.base);
    const untracked = await list('ls-files', '--others', '--exclude-standard', '-z');
    return [...new Set([...changed, ...untracked])].sort();
  });
  const files = await Promise.all(names.slice(0, MAX_FILES).map((p) => gitDiff(wt, p, e.base)));
  return { files, ...(names.length > MAX_FILES ? { truncated: true } : {}) };
}

export const mergeExperiment = (ctx: Ctx, n: number): Promise<Experiment> =>
  lockedExp(ctx.root, async () => {
    const e = await getExperiment(ctx.root, n);
    if (e.status !== 'created' && e.status !== 'ready') throw closed(e);
    const wt = await owned(ctx, e);
    if (!wt) throw new AppError('EXPERIMENT_NO_WORKTREE', `Worktree of experiment ${n} is missing`, 409);
    const branch = `exp/${n}`;
    const title = (e.hypothesis ?? 'experiment').split('\n')[0]!.slice(0, 72);
    await locked(wt, async (git) => {
      if (!(await git.status()).files.length) return;
      await git.raw(['add', '-A']);
      await git.raw(['commit', '-m', `${branch}: ${title}`]);
    });
    await inRepo(ctx.root, async (git) => {
      // app state (runs, this record) is written all the time and untracked files (eval results) are left alone;
      // a merge that would overwrite either still fails safely in git
      const dirty = (await git.status()).files.some((f) => f.index !== '?' && !f.path.startsWith(`${APP_DIR}/`));
      if (dirty) throw new AppError('GIT_DIRTY', 'The working tree has changes', 409);
      try {
        await git.raw(['merge', '--no-ff', '-m', `Merge ${branch}: ${title}`, branch]);
      } catch (err) {
        const list = (...a: string[]) => git.raw(a).then((o) => o.split('\0').filter(Boolean), () => []);
        const files = await list('diff', '--name-only', '-z', '--diff-filter=U');
        await git.raw(['merge', '--abort']).catch(() => undefined); // nothing to abort if git refused upfront
        if (files.length) throw new AppError('GIT_CONFLICT', `Merge conflict in: ${files.join(', ')}`, 409);
        // git refuses (before touching anything) to overwrite untracked files; name them (its message is localized)
        const added = await list('diff', '--name-only', '-z', '--no-renames', `HEAD...${branch}`);
        const blocking = added.length ? await list('ls-files', '--others', '--exclude-standard', '-z', '--', ...added) : [];
        throw new AppError('GIT_CONFLICT', blocking.length
          ? `Untracked files in the main tree would be overwritten by the merge: ${blocking.join(', ')}`
          : (err as Error).message, 409);
      }
      await git.raw(['worktree', 'remove', '--force', wt]);
      await git.raw(['branch', '-d', branch]);
    });
    return saveExperiment(ctx.root, touch(e, { status: 'merged' }));
  });

export const discardExperiment = (ctx: Ctx, n: number): Promise<Experiment> =>
  lockedExp(ctx.root, async () => {
    const e = await getExperiment(ctx.root, n);
    if (e.status === 'merged' || e.status === 'discarded') throw closed(e);
    const wt = await owned(ctx, e);
    await inRepo(ctx.root, async (git) => {
      if (wt) await git.raw(['worktree', 'remove', '--force', wt]);
      await git.raw(['worktree', 'prune']);
      await git.raw(['branch', '-D', `exp/${n}`]).catch(() => undefined); // may be gone already
    });
    return saveExperiment(ctx.root, touch(e, { status: 'discarded' }));
  });
