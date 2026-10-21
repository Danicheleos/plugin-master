import { readdir, readFile, stat } from 'node:fs/promises';
import { RunMetaSchema, type RunsResponse, type Trace } from '@pm/protocol';
import { readTrace } from '../evals/traces';
import { AppError } from '../lib/errors';
import { resolveInSpace } from '../files/safe-path';
import { RUN_ID, runDir } from './recorder';

const MAX_RUNS = 200;

/** Newest first by last activity (mtime of messages.jsonl); a broken meta.json becomes `{id, error}`. */
export async function listRuns(root: string): Promise<RunsResponse> {
  const base = resolveInSpace(root, '.plugin-master/runs');
  const dirs = await readdir(base, { withFileTypes: true }).catch(() => []);
  const ids = dirs.filter((d) => d.isDirectory() && RUN_ID.test(d.name));
  const timed = await Promise.all(
    ids.map(async (d) => ({
      id: d.name,
      at: await stat(`${runDir(root, d.name)}/messages.jsonl`).then(
        (s) => s.mtimeMs,
        () => 0,
      ),
    })),
  );
  timed.sort((a, b) => b.at - a.at);
  const runs = await Promise.all(
    timed.slice(0, MAX_RUNS).map(async ({ id }) => {
      try {
        const text = await readFile(`${runDir(root, id)}/meta.json`, 'utf8');
        return RunMetaSchema.parse(JSON.parse(text));
      } catch (e) {
        return { id, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  return { runs };
}

export async function readRunTrace(root: string, id: string): Promise<Trace> {
  if (!RUN_ID.test(id)) throw new AppError('RUN_NOT_FOUND', 'Run not found', 404);
  const path = `${runDir(root, id)}/messages.jsonl`;
  if (!(await stat(path).then((s) => s.isFile(), () => false)))
    throw new AppError('RUN_NOT_FOUND', 'Run not found', 404);
  try {
    return await readTrace(path);
  } catch (e) {
    throw new AppError('RUN_UNREADABLE', `Cannot read the run: ${String(e)}`, 422);
  }
}
