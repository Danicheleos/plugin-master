import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EvalCase, Trace } from '@pm/protocol';
import { resolveInSpace } from '../files/safe-path';
import { withLock } from '../spaces/config-file';
import { allIds, isFileId, parseRun, resultsRoot } from './results';
import { attachMetrics, traceResponse } from './traces';

const EXPORTS = '.plugin-master/exports/evals';
const safe = (s: string) => s.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '_');

type IndexRun = { runId: string; file: string; startedAt?: string; fingerprint: string; score?: number };
type CaseIndex = { case: string; exportedAt: string; runs: IndexRun[] };
export type ExportSummary = { case: string; dir: string; written: number; skipped: number; total: number };

/**
 * Saves the whole history of one case to `.plugin-master/exports/evals/<case>/`: a file per run
 * (`<run>.json`: the case result with all metrics plus the parsed trace of every arm run) and an
 * `index.json`. A repeated export rewrites only runs that are new or whose data changed.
 */
export async function exportCase(root: string, name: string): Promise<ExportSummary> {
  const dir = `${EXPORTS}/${safe(name)}`;
  return withLock(`${root}\0export\0${name}`, async () => {
    const base = await resultsRoot(root);
    const indexFile = resolveInSpace(root, `${dir}/index.json`);
    const old: CaseIndex | undefined = await readFile(indexFile, 'utf8').then(JSON.parse, () => undefined);
    const known = new Map((old?.runs ?? []).map((r) => [r.runId, r]));
    const seen = new Set<string>();
    const runs: IndexRun[] = [];
    let written = 0;
    // run dirs first: a top-level `<name>.json` copy of the same invocation is dropped
    const ids = (await allIds(base)).sort((a, b) => Number(isFileId(a)) - Number(isFileId(b)));
    for (const id of ids) {
      let result;
      try {
        result = await parseRun(root, base, id);
      } catch {
        continue;
      }
      const c: EvalCase | undefined = result.cases.find((x) => x.name === name);
      const key = `${result.startedAt}\0${result.suite.plugins?.[0]?.name}`;
      if (!c || seen.has(key)) continue;
      seen.add(key);
      await attachMetrics(root, base, id, result);
      const fingerprint = createHash('sha1').update(JSON.stringify([c, result.startedAt, result.claudeVersion])).digest('hex');
      const file = `${safe(id.replace(/\.json$/, ''))}.json`;
      const entry: IndexRun = { runId: id, file, startedAt: result.startedAt, fingerprint, score: c.aggregates.score };
      runs.push(entry);
      if (known.get(id)?.fingerprint === fingerprint && known.get(id)?.file === file) continue;
      const traces: Record<string, Trace> = {};
      for (const arm of ['with', 'without'] as const)
        for (const [i, run] of c.arms[arm].entries())
          if (run.traceMetrics) {
            const t = await traceResponse(root, base, id, result, { case: name, arm, n: String(i + 1) }).catch(() => undefined);
            if (t) traces[`${arm}/${i + 1}`] = t;
          }
      const target = resolveInSpace(root, `${dir}/${file}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(
        target,
        JSON.stringify({ runId: id, startedAt: result.startedAt, model: result.suite.modelOverride ?? null, claudeVersion: result.claudeVersion, case: c, traces }, null, 2),
      );
      written++;
    }
    runs.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
    await mkdir(dirname(indexFile), { recursive: true });
    await writeFile(indexFile, JSON.stringify({ case: name, exportedAt: new Date().toISOString(), runs } satisfies CaseIndex, null, 2));
    return { case: name, dir, written, skipped: runs.length - written, total: runs.length };
  });
}
