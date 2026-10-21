import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatEvent } from '@pm/protocol';
import { getFeatures } from '../features/service';
import { gitCommit, gitStatus } from '../git/service';

/**
 * Dirty paths (`git status --porcelain`) with their XY code, for a staged rename the old path, and
 * a sha1 of the working-tree content (null when missing or not a regular file/symlink).
 */
export type Snapshot = Map<string, { code: string; from?: string; hash: string | null }>;

/**
 * App-owned state (runs written every turn, plans/config edited from the UI), not the agent's work:
 * never auto-committed.
 */
const IGNORED = /^\.plugin-master(\/|$)/;

/** More changed paths than this are not committed automatically. */
const MAX_PATHS = 200;

const enabled = async (root: string) => {
  const f = await getFeatures(root);
  return f.git && f.autoCommit;
};

/** Files larger than this are compared by size and mtime, not read. */
const MAX_HASH_BYTES = 8 * 1024 * 1024;
/** Files hashed at once (a dirty tree can list thousands of untracked files). */
const HASH_CONCURRENCY = 16;

const sha1 = (data: string | Buffer) => createHash('sha1').update(data).digest('hex');

/**
 * Content signature of a working-tree path: sha1 of a file, of a symlink's target text (never
 * followed), `size:mtime` above `MAX_HASH_BYTES`; null when missing or another kind.
 */
async function hashOf(root: string, path: string): Promise<string | null> {
  try {
    const abs = join(root, path);
    const st = await lstat(abs);
    if (st.isSymbolicLink()) return sha1(await readlink(abs));
    if (!st.isFile()) return null;
    if (st.size > MAX_HASH_BYTES) return `${st.size}:${st.mtimeMs}`;
    return sha1(await readFile(abs));
  } catch {
    return null;
  }
}

/** `hashOf` for every path, at most `HASH_CONCURRENCY` at a time. */
async function hashAll(root: string, paths: string[]): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const i = next++;
      out[i] = await hashOf(root, paths[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(HASH_CONCURRENCY, paths.length) }, worker));
  return out;
}

/** Dirty paths outside `.plugin-master/`, or null when auto-commit is off or the space is not a repo. */
async function dirty(root: string) {
  if (!(await enabled(root))) return null;
  const s = await gitStatus(root, true);
  if (!s.isRepo) return null;
  return s.files
    .filter((f) => !IGNORED.test(f.path))
    .map((f) => ({ path: f.path, code: f.index + f.workingDir, from: f.from }));
}

/** Dirty paths now with their content hashes, or null when auto-commit is off or not a repo. */
export async function snapshot(root: string): Promise<Snapshot | null> {
  try {
    const files = await dirty(root);
    if (!files) return null;
    const hashes = await hashAll(root, files.map((f) => f.path));
    return new Map(files.map((f, i) => [f.path, { code: f.code, from: f.from, hash: hashes[i] }]));
  } catch {
    return null;
  }
}

const subject = (prompt: string) => {
  const line = (prompt.split('\n').find((l) => l.trim()) ?? '').trim();
  return `agent: ${line.length > 60 ? `${line.slice(0, 59)}…` : line}`;
};

/**
 * Commits what changed since `before` (taken when the turn was sent): paths absent from it, with
 * another status or with other content. A path dirty before the turn and unchanged since is left
 * alone (the user's own work); one the agent edited further is committed whole, including the
 * user's earlier uncommitted edits in that file. Returns the chat event to show, or null when there
 * was nothing to do.
 */
export async function commitTurn(
  root: string,
  before: Snapshot | null,
  prompt: string,
  runId: string | null,
): Promise<ChatEvent | null> {
  if (!before) return null;
  try {
    const after = await dirty(root); // re-checks the flags at commit time
    if (!after) return null;
    // only paths with an unchanged status need their content compared
    const same = after.filter((f) => before.get(f.path)?.code === f.code);
    const hashes = await hashAll(root, same.map((f) => f.path));
    const untouched = new Set(
      same.filter((f, i) => before.get(f.path)?.hash === hashes[i]).map((f) => f.path),
    );
    // a staged rename commits both sides, else the old path stays staged as a deletion
    const paths = after
      .filter((f) => !untouched.has(f.path))
      .flatMap((f) => (f.from ? [f.path, f.from] : [f.path]));
    if (!paths.length) return null;
    if (paths.length > MAX_PATHS)
      return {
        kind: 'error',
        message: `Auto-commit skipped: ${paths.length} changed files, commit manually`,
      };
    const message = [subject(prompt), ...(runId ? ['', `Run: ${runId}`] : [])].join('\n');
    const { hash } = await gitCommit(root, message, paths);
    return { kind: 'commit', hash, files: paths.length, message: message.split('\n')[0] };
  } catch (e) {
    return {
      kind: 'error',
      message: `Auto-commit failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
