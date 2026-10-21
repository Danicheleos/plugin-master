import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import type {
  GitBranches,
  GitCommit,
  GitDiff,
  GitStatus,
} from '@pm/protocol';
import { simpleGit, type SimpleGit } from 'simple-git';
import { resolveInSpace } from '../files/safe-path';
import { AppError } from '../lib/errors';
import { withLock } from '../spaces/config-file';

const MAX_DIFF_BYTES = 1024 * 1024;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/; // never starts with `-`

/**
 * Serializes git calls per repo (own lock key, separate from the config lock). `flag` is a
 * top-level git option: literal pathspecs by default (`[ab].md` is a name, not a glob), not set
 * via the environment because simple-git rejects some env vars. A non-zero exit is an error
 * even when git printed nothing to stderr (e.g. a hook that just `exit 1`s).
 */
export const locked = <T>(
  root: string,
  fn: (git: SimpleGit) => Promise<T>,
  flag = '--literal-pathspecs',
) =>
  withLock(`${root}\0git`, async () => {
    try {
      return await fn(
        simpleGit({
          baseDir: root,
          binary: ['git', flag],
          errors: (e, r) =>
            r.exitCode && !e ? new Error(`git exited ${r.exitCode}`) : e,
        }),
      );
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('GIT_ERROR', (e as Error).message, 409);
    }
  });

const isRepo = (root: string) => existsSync(resolveInSpace(root, '.git'));

/** Like `locked`, but the space must be a repo. */
export const inRepo = <T>(root: string, fn: (git: SimpleGit) => Promise<T>) =>
  locked(root, (git) => {
    if (!isRepo(root))
      throw new AppError('NOT_A_REPO', 'The space is not a git repository', 409);
    return fn(git);
  });

/** Space-relative `/`-separated path, validated against the space. */
const relPath = (root: string, p: string) =>
  relative(root, resolveInSpace(root, p)).split(sep).join('/');

function branchName(name: string): string {
  if (!BRANCH_RE.test(name)) throw invalidBranch(name);
  return name;
}
const invalidBranch = (name: string) =>
  new AppError('INVALID_BRANCH', `Invalid branch name "${name}"`, 400);

async function statusOf(git: SimpleGit): Promise<GitStatus> {
  const s = await git.status();
  return {
    isRepo: true,
    branch: s.detached ? null : s.current,
    ...(s.tracking ? { ahead: s.ahead, behind: s.behind } : {}),
    files: s.files.map((f) => ({
      path: f.path,
      ...(f.from ? { from: f.from } : {}),
      index: f.index,
      workingDir: f.working_dir,
    })),
  };
}

/** `readOnly` (background snapshots) skips the optional index refresh, so it never takes index.lock. */
export const gitStatus = (
  root: string,
  readOnly = false,
): Promise<GitStatus> =>
  locked(
    root,
    async (git) => (isRepo(root) ? statusOf(git) : { isRepo: false }),
    readOnly ? '--no-optional-locks' : undefined,
  );

export const gitInit = (root: string): Promise<GitStatus> =>
  locked(root, async (git) => {
    if (!isRepo(root)) await git.init();
    return statusOf(git);
  });

/** `ref` = the old side (default HEAD); the new side is the file on disk. */
export const gitDiff = (root: string, path: string, ref = 'HEAD'): Promise<GitDiff> =>
  inRepo(root, async (git) => {
    const rel = relPath(root, path);
    const abs = resolveInSpace(root, rel);
    const size = await stat(abs).catch(() => null);
    if (size?.isDirectory())
      throw new AppError('NOT_A_FILE', `"${rel}" is a directory`, 400);
    const oldSize = Number(
      await git.raw(['cat-file', '-s', `${ref}:${rel}`]).catch(() => '0'),
    );
    if ((size?.size ?? 0) > MAX_DIFF_BYTES || oldSize > MAX_DIFF_BYTES)
      return { path: rel, old: '', new: '', tooLarge: true };
    const old = await git.raw(['show', `${ref}:${rel}`]).catch(() => '');
    const cur = size ? await readFile(abs, 'utf8') : '';
    if (old.includes('\0') || cur.includes('\0'))
      return { path: rel, old: '', new: '', binary: true };
    return { path: rel, old, new: cur };
  });

export const gitLog = (root: string, limit: number): Promise<GitCommit[]> =>
  inRepo(root, async (git) => {
    const n = Number.isFinite(limit) ? Math.min(Math.max(1, limit), 200) : 30;
    if (!(await git.raw(['rev-parse', '--verify', '-q', 'HEAD']).catch(() => '')))
      return []; // unborn HEAD: no commits yet
    const log = await git.log({ maxCount: n });
    return log.all.map((c) => ({
      hash: c.hash,
      date: c.date,
      message: c.message,
      author: c.author_name,
    }));
  });

export const gitBranches = (root: string): Promise<GitBranches> =>
  inRepo(root, async (git) => {
    const b = await git.branchLocal();
    return { current: b.detached ? null : b.current, local: b.all };
  });

/** Stages `paths` (default: everything) and commits only them; returns the new hash. */
export const gitCommit = (
  root: string,
  message: string,
  paths?: string[],
): Promise<{ hash: string }> =>
  inRepo(root, async (git) => {
    const rels = paths?.length ? paths.map((p) => relPath(root, p)) : [];
    const only = rels.length ? ['--', ...rels] : [];
    // `add` rejects a path that is neither on disk nor in the index (the old side of a staged
    // rename or deletion: already staged, only `commit -- path` needs it)
    const tracked = rels.length
      ? (await git.raw(['ls-files', '-z', '--', ...rels])).split('\0')
      : [];
    const addable = rels.filter(
      (r) =>
        existsSync(resolveInSpace(root, r)) ||
        tracked.some((t) => t === r || t.startsWith(`${r}/`)),
    );
    if (!rels.length || addable.length) await git.raw(['add', '-A', ...(rels.length ? ['--', ...addable] : [])]);
    // with paths, `commit -- paths` leaves other staged files out of the commit
    if (!(await git.raw(['diff', '--cached', '--name-only', ...only])).trim())
      throw new AppError('NOTHING_TO_COMMIT', 'Nothing to commit', 409);
    await git.raw(['commit', '-m', message, ...only]);
    return { hash: (await git.revparse(['HEAD'])).trim() };
  });

export const gitCreateBranch = (
  root: string,
  name: string,
  from?: string,
): Promise<GitStatus> =>
  inRepo(root, async (git) => {
    const start = from === undefined ? [] : [branchName(from)];
    await git.raw(['check-ref-format', '--branch', branchName(name)]).catch(() => {
      throw invalidBranch(name);
    });
    await git.raw(['branch', name, ...start]);
    return statusOf(git);
  });

/** Never discards changes: with `carry` git carries them over or refuses. */
export const gitSwitch = (
  root: string,
  name: string,
  carry?: boolean,
): Promise<GitStatus> =>
  inRepo(root, async (git) => {
    branchName(name);
    if (!carry && (await git.status()).files.length)
      throw new AppError('GIT_DIRTY', 'The working tree has changes', 409);
    await git.raw(['switch', name]);
    return statusOf(git);
  });
