import { chmod, copyFile, lstat, mkdir, readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import {
  EvalResultSchema,
  type EvalResult,
  type Trace,
  type TraceMetrics,
} from '@pm/protocol';
import { resolveInSpace } from '../files/safe-path';
import { AppError } from '../lib/errors';
import { RESULT_FILE } from './eval-dir';
import { parseTrace } from './trace';
import { cached, hashOf } from './trace-cache';
import { retrievalOf, TruthSchema, type Retrieval, type Truth } from './retrieval';

type Arm = 'with' | 'without';
const TRACES = 'traces';

/** A case name is used as a file name: no separators, no dot names. */
const safeName = (s: string) =>
  !!s && s !== '.' && s !== '..' && !/[/\\\0]/.test(s);

const file = (caseName: string, n: number) => `${caseName}-${n}.jsonl`;
const isFile = (p: string) => stat(p).then((s) => s.isFile(), () => false);

/** Key of the user's harness dirs: the run's `startedAt` with `:` and `.` turned into `-`. */
const harnessKey = (startedAt: string) => startedAt.replace(/[:.]/g, '-');

/**
 * Our own copy (`<run dir>/traces/<arm>/<case>-<n>.jsonl`) first, then the harness layout
 * `<results>/traces/<anything>/<startedAt key>/<case>-<n>.jsonl` (with arm only; the harness
 * keeps its bare suite as separate results). `n` is the 1-based index within the arm.
 */
async function findTrace(
  root: string,
  results: string,
  runId: string,
  startedAt: string | undefined,
  caseName: string,
  arm: Arm,
  n: number,
): Promise<string | undefined> {
  if (!safeName(caseName)) return undefined;
  const inSpace = (p: string) => resolveInSpace(root, relative(root, p));
  // a top-level `<name>.json` result file has no run dir of its own
  if (!runId.endsWith('.json')) {
    const own = inSpace(join(results, runId, TRACES, arm, file(caseName, n)));
    if (await isFile(own)) return own;
  }
  if (arm !== 'with' || !startedAt) return undefined;
  const base = join(results, TRACES);
  const dirs = await readdir(base, { withFileTypes: true }).catch(() => []);
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const p = inSpace(join(base, d.name, harnessKey(startedAt), file(caseName, n)));
    if (await isFile(p)) return p;
  }
  return undefined;
}

export async function readTrace(path: string): Promise<Trace> {
  return parseTrace(await readFile(path, 'utf8'));
}

/** Parsed metrics by file mtime and size (also on disk, see `trace-cache.ts`), so repeated views and restarts do not re-parse. */
async function readMetrics(root: string, path: string): Promise<TraceMetrics> {
  const { entry, update } = await cached(root, path, await stat(path));
  if (entry.metrics) return entry.metrics;
  const { metrics } = await readTrace(path);
  entry.metrics = metrics;
  update();
  return metrics;
}

/** `<case dir>/truth.json` (what a right answer names); undefined when the case has none or it is invalid. */
async function readTruth(root: string, dir: string): Promise<{ truth: Truth; raw: string } | undefined> {
  try {
    const raw = await readFile(resolveInSpace(root, `${dir}/truth.json`), 'utf8');
    const truth = TruthSchema.safeParse(JSON.parse(raw));
    return truth.success ? { truth: truth.data, raw } : undefined;
  } catch {
    return undefined;
  }
}

/** Retrieval metrics of a trace by file mtime, size and truth, so repeated views do not re-read it. */
async function readRetrieval(
  root: string,
  path: string,
  { truth, raw }: { truth: Truth; raw: string },
): Promise<Retrieval> {
  const { entry, update } = await cached(root, path, await stat(path));
  const hash = hashOf(raw);
  if (entry.retrieval && entry.truth === hash) return entry.retrieval;
  entry.retrieval = retrievalOf(truth, await readFile(path, 'utf8'));
  entry.truth = hash;
  update();
  return entry.retrieval;
}

/** Fills `traceMetrics` of every arm run that has a trace. Never throws: a broken trace is just skipped. */
export async function attachMetrics(
  root: string,
  results: string,
  runId: string,
  result: EvalResult,
): Promise<void> {
  await Promise.all(
    result.cases.flatMap((c) =>
      (['with', 'without'] as const).flatMap((arm) =>
        c.arms[arm].map(async (run, i) => {
          try {
            const p = await findTrace(root, results, runId, result.startedAt, c.name, arm, i + 1);
            if (!p) return;
            run.traceMetrics = await readMetrics(root, p);
            const truth = c.dir && !run.metrics ? await readTruth(root, c.dir) : undefined;
            if (truth) run.metrics = await readRetrieval(root, p, truth);
          } catch {
            /* no metrics for this run */
          }
        }),
      ),
    ),
  );
}

export async function traceResponse(
  root: string,
  results: string,
  runId: string,
  result: EvalResult,
  q: { case?: string; arm?: string; n?: string },
): Promise<Trace> {
  const n = Number(q.n);
  if (!q.case || !safeName(q.case) || (q.arm !== 'with' && q.arm !== 'without') || !Number.isInteger(n) || n < 1)
    throw new AppError('INVALID_TRACE_QUERY', 'Expected case, arm=with|without and n >= 1', 400);
  const p = await findTrace(root, results, runId, result.startedAt, q.case, q.arm, n);
  if (!p) throw new AppError('TRACE_NOT_FOUND', 'No trace for this run', 404);
  const trace = await readTrace(p);
  // Some harness traces start at the first model call without the user turn: use the case's prompt.
  const md = result.cases.find((c) => c.name === q.case)?.promptMarkdown;
  const prompt = typeof md === 'string' ? md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim() : '';
  return trace.prompt || !prompt ? trace : { ...trace, prompt };
}

/** Real temp roots the CLI may create its `e-*` sandboxes in (macOS: `/var/folders/...` vs `/private/tmp`). */
async function tmpRoots(): Promise<string[]> {
  const roots = await Promise.all(
    [tmpdir(), '/tmp'].map((d) => realpath(d).catch(() => undefined)),
  );
  return [...new Set(roots.flatMap((r) => (r ? [r] : [])))];
}

/**
 * The CLI sandbox `<tmp root>/e-*` that contains `p` (or is `p`). Undefined unless it sits directly
 * under a real temp root and is a real directory (never a symlink), so nothing else is deleted.
 */
async function sandboxOf(p: string): Promise<string | undefined> {
  const real = await realpath(p).catch(() => undefined);
  if (!real) return undefined;
  for (const tmp of await tmpRoots()) {
    const first = relative(tmp, real).split(sep)[0] ?? '';
    if (!/^e-[\w-]+$/.test(first)) continue;
    const dir = join(tmp, first);
    if (dir !== real && !real.startsWith(dir + sep)) continue;
    if ((await lstat(dir).catch(() => undefined))?.isDirectory()) return dir;
  }
  return undefined;
}

/** The CLI keeps sandboxes read-only with a mode-000 `sealed/`: make the tree removable (no symlink is followed). */
async function unseal(dir: string): Promise<void> {
  await chmod(dir, 0o700).catch(() => undefined);
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => []))
    if (e.isDirectory()) await unseal(join(dir, e.name));
}

/** Sandbox paths from the CLI output (`⚠ kept <path>: ...`), for runs that wrote no aggregate. */
export const keptPaths = (lines: string[]): string[] =>
  lines.flatMap((l) => {
    const m = /^\S*\s*kept (\/[^\s:]+):/.exec(l);
    return m ? [m[1] as string] : [];
  });

/**
 * After a run: copies each run's `tracePath` to `<out>/traces/<arm>/<case>-<n>.jsonl` and removes
 * the kept sandboxes (those of the results, plus the `kept` ones the CLI printed). A sandbox whose
 * copy failed is left. Problems go to `log`; harvesting never fails the run.
 */
export async function harvestTraces(
  out: string,
  log: (line: string) => void,
  kept: string[] = [],
): Promise<void> {
  try {
    const raw = await readFile(join(out, RESULT_FILE), 'utf8').catch(() => undefined);
    const result = raw === undefined ? undefined : EvalResultSchema.parse(JSON.parse(raw));
    const roots = new Map<string, boolean>(); // sandbox -> every copy from it succeeded
    for (const c of result?.cases ?? [])
      for (const arm of ['with', 'without'] as const)
        for (const [i, run] of c.arms[arm].entries()) {
          if (!run.tracePath || !(await lstat(run.tracePath).then((s) => s.isFile(), () => false))) continue;
          let sandbox: string | undefined;
          try {
            sandbox = await sandboxOf(run.tracePath);
            if (!safeName(c.name)) throw new Error(`unsafe case name "${c.name}"`);
            const dest = join(out, TRACES, arm, file(c.name, i + 1));
            await mkdir(dirname(dest), { recursive: true });
            await copyFile(run.tracePath, dest);
            if (sandbox) roots.set(sandbox, roots.get(sandbox) ?? true);
          } catch (e) {
            if (sandbox) roots.set(sandbox, false);
            log(`Could not keep the trace of ${c.name} (${arm} ${i + 1}): ${e instanceof Error ? e.message : e}`);
          }
        }
    for (const k of kept) {
      const sandbox = await sandboxOf(k);
      if (sandbox && !roots.has(sandbox)) roots.set(sandbox, true);
    }
    for (const [sandbox, ok] of roots)
      if (ok)
        await unseal(sandbox).then(() => rm(sandbox, { recursive: true, force: true })).catch((e) =>
          log(`Could not remove ${sandbox}: ${e}`),
        );
  } catch (e) {
    log(`Trace harvesting failed: ${e instanceof Error ? e.message : e}`);
  }
}
