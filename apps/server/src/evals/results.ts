import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  EvalResultSchema,
  type EvalGroup,
  type EvalGroupResponse,
  type EvalResult,
  type EvalRunResponse,
  type EvalRunSummary,
  type EvalSuitesResponse,
  type Trace,
} from '@pm/protocol';
import { AppError } from '../lib/errors';
import { resolveInSpace } from '../files/safe-path';
import { evalDir, pluginName, RESULT_FILE } from './eval-dir';
import { groupRuns, mergeGroup, type RunInput } from './groups';
import { attachMetrics, traceResponse } from './traces';
import { readMeta } from '../versions/sidecar';
import { readConfig } from '../spaces/config-file';
import { buildSuites, type SuiteRun } from './suites';

const MAX_DEPTH = 3;

export const resultsRoot = async (root: string) =>
  resolveInSpace(root, `${await evalDir(root)}/results`);

/** Run ids (dirs under `results/`, depth <= 3) that contain an aggregate-result.json. */
async function runIds(base: string, rel = '', depth = 1): Promise<string[]> {
  const entries = await readdir(join(base, rel), { withFileTypes: true }).catch(
    () => [],
  );
  const ids: string[] = [];
  for (const e of entries) {
    if (e.isFile() && e.name === RESULT_FILE && rel) ids.push(rel);
    if (e.isDirectory() && depth < MAX_DEPTH)
      ids.push(...(await runIds(base, join(rel, e.name), depth + 1)));
  }
  return ids;
}

export const isFileId = (id: string) => id.endsWith('.json') && !id.includes('/');

/** Every run id under `base`: nested run dirs plus top-level result files. */
export const allIds = async (base: string) => [...(await runIds(base)), ...(await fileIds(base))];

/** Top-level `results/*.json` files with a `schemaVersion` (e.g. a harness' `bare.json`): runs whose id is the file name. */
async function fileIds(base: string): Promise<string[]> {
  const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
  const ids = await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map(async (e) => {
        try {
          const j = JSON.parse(await readFile(join(base, e.name), 'utf8'));
          return j && typeof j === 'object' && 'schemaVersion' in j ? [e.name] : [];
        } catch {
          return [];
        }
      }),
  );
  return ids.flat();
}

function summarize(id: string, r: EvalResult): EvalRunSummary {
  const runs = r.cases.flatMap((c) => [...c.arms.with, ...c.arms.without]);
  return {
    id,
    startedAt: r.startedAt,
    overallScore: r.aggregates.overallScore,
    overallPassRate: r.aggregates.overallPassRate,
    casesPassed: r.aggregates.casesPassed,
    casesTotal: r.aggregates.casesTotal,
    ablation: r.suite.ablation,
    threshold: r.suite.threshold,
    modelOverride: r.suite.modelOverride,
    costUsd: r.costUsd,
    durationSeconds: r.durationSeconds,
    claudeVersion: r.claudeVersion,
    pluginVersion: r.suite.plugins?.[0]?.version,
    partial: r.partial,
    partialReason: r.partialReason,
    skippedPaid: runs.some((run) => run.skippedPaidGraders),
  };
}

/** A file inside a run dir; resolved again so a symlinked file cannot point out of the space. */
const inRun = (root: string, dir: string, name: string) =>
  resolveInSpace(root, relative(root, join(dir, name)));

/** The result file of a run: `<id>/aggregate-result.json`, or the file itself for a `*.json` id. */
const resultFile = (root: string, base: string, id: string) =>
  isFileId(id) ? inRun(root, base, id) : inRun(root, join(base, id), RESULT_FILE);

export async function parseRun(root: string, base: string, id: string): Promise<EvalResult> {
  const raw = await readFile(resultFile(root, base, id), 'utf8');
  return EvalResultSchema.parse(JSON.parse(raw));
}

/** Every run with the data grouping needs; a broken file gets `error`, never thrown. */
export async function loadRuns(root: string): Promise<RunInput[]> {
  const base = await resultsRoot(root);
  return Promise.all(
    (await allIds(base)).map(async (id): Promise<RunInput> => {
      const hasReport =
        !isFileId(id) &&
        (await Promise.resolve()
          .then(() => stat(inRun(root, join(base, id), 'report.html')))
          .then((s) => s.isFile(), () => false));
      try {
        const r = await parseRun(root, base, id);
        return {
          summary: { ...summarize(id, r), hasReport },
          cases: r.cases.map((c) => ({
            name: c.name,
            score: c.aggregates.score,
            runs: c.arms.with.length + c.arms.without.length,
          })),
        };
      } catch (e) {
        return {
          summary: { id, error: e instanceof Error ? e.message : String(e), hasReport },
          cases: [],
        };
      }
    }),
  );
}

export const mean = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
};

/** Mean metrics of one arm's runs; `score`/`passRate` prefer the harness' aggregates. */
function armMetrics(arm: EvalResult['cases'][number]['arms']['with'], score?: number, passRate?: number) {
  return {
    score: score ?? mean(arm.map((x) => x.score)),
    costUsd: mean(arm.map((x) => (x.costUsd === undefined ? undefined : x.costUsd + (x.judgeCostUsd ?? 0)))),
    turns: mean(arm.map((x) => x.traceMetrics?.numTurns ?? x.turns)),
    maxContext: mean(arm.map((x) => x.traceMetrics?.maxContext)),
    tokens: mean(arm.map((x) => x.traceMetrics && x.traceMetrics.inputTokens + x.traceMetrics.outputTokens)),
    durationMs: mean(arm.map((x) => x.traceMetrics?.durationMs ?? (x.durationSeconds === undefined ? undefined : x.durationSeconds * 1000))),
    recall: mean(arm.map((x) => x.metrics?.recall ?? undefined)),
    precision: mean(arm.map((x) => x.metrics?.precision ?? undefined)),
    f1: mean(arm.map((x) => x.metrics?.f1 ?? undefined)),
    passRate: passRate ?? mean(arm.map((x) => (x.passed === undefined ? undefined : Number(x.passed)))),
  };
}

/** Every readable run reduced to what `buildSuites` needs (trace metrics only from the mtime cache). */
async function loadSuiteRuns(root: string): Promise<SuiteRun[]> {
  const base = await resultsRoot(root);
  const runs = await Promise.all(
    (await allIds(base)).map(async (id): Promise<SuiteRun[]> => {
      try {
        const r = await parseRun(root, base, id);
        await attachMetrics(root, base, id, r);
        return [
          {
            id,
            startedAt: r.startedAt,
            model: r.suite.modelOverride ?? null,
            commit: isFileId(id) ? undefined : (await readMeta(root, await evalDir(root), id))?.commit,
            plugin: r.suite.plugins?.[0]?.name,
            caseDirs: r.cases.flatMap((c) => (c.dir ? [c.dir] : [])),
            cases: r.cases.map((c) => ({
              name: c.name,
              ...armMetrics(c.arms.with, c.aggregates.score, c.aggregates.passRate),
              without: c.arms.without.length
                ? armMetrics(c.arms.without, c.aggregates.scoreWithout)
                : undefined,
            })),
          },
        ];
      } catch {
        return [];
      }
    }),
  );
  return runs.flat();
}

async function readConfigPins(root: string) {
  const c = await readConfig(root);
  return [c.evalBaselines, c.evalRefs] as const;
}

export async function listSuites(root: string): Promise<EvalSuitesResponse> {
  return {
    dir: await evalDir(root),
    suites: buildSuites(await loadSuiteRuns(root), await pluginName(root), ...(await readConfigPins(root))),
  };
}

/** Newest group first. */
export async function listGroups(root: string): Promise<EvalGroup[]> {
  return groupRuns(await loadRuns(root));
}

export async function readGroup(root: string, groupId: string): Promise<EvalGroupResponse> {
  // any member id resolves its group: the id (first run) changes when an earlier run lands later
  const group = (await listGroups(root)).find((g) => g.runIds.includes(groupId));
  if (!group) throw new AppError('RUN_NOT_FOUND', 'Eval group not found', 404);
  const result = await readMerged(root, group, true);
  return { id: group.id, group, unknownSchema: result.schemaVersion !== 1, result };
}

/** The merged result of a group (see `mergeGroup`; `all` keeps every invocation); throws when a run is unreadable. */
export async function readMerged(root: string, group: EvalGroup, all = false): Promise<EvalResult> {
  const results = new Map(
    await Promise.all(
      group.runIds.map(async (id) => [id, (await readRun(root, id)).result] as const),
    ),
  );
  return mergeGroup(group, results, all);
}

/** Absolute dir of a run. `runId` may be nested (`plugin-eval/x`) but never has empty, `.`/`..` or backslash segments. */
async function runDir(root: string, runId: string): Promise<string> {
  const parts = runId.split('/');
  if (
    parts.length >= MAX_DEPTH ||
    parts.some((p) => !p || p === '.' || p === '..' || p.includes('\\'))
  )
    throw new AppError('INVALID_RUN_ID', 'Invalid run id', 400);
  return resolveInSpace(root, `${await evalDir(root)}/results/${runId}`);
}

export async function readRun(root: string, runId: string): Promise<EvalRunResponse> {
  await runDir(root, runId); // validates the id
  const base = await resultsRoot(root);
  try {
    const result = await parseRun(root, base, runId);
    await attachMetrics(root, base, runId, result);
    return { id: runId, unknownSchema: result.schemaVersion !== 1, result };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
      throw new AppError('RUN_NOT_FOUND', 'Eval run not found', 404);
    throw new AppError('RUN_UNREADABLE', 'Eval result is not valid JSON', 422);
  }
}

export async function readReport(root: string, runId: string): Promise<string> {
  const dir = await runDir(root, runId);
  if (isFileId(runId)) throw new AppError('REPORT_NOT_FOUND', 'Report not found', 404);
  return readFile(inRun(root, dir, 'report.html'), 'utf8').catch(() => {
    throw new AppError('REPORT_NOT_FOUND', 'Report not found', 404);
  });
}

/** Parsed trace of one arm run (`n` is 1-based within the arm). */
export async function readRunTrace(
  root: string,
  runId: string,
  q: { case?: string; arm?: string; n?: string },
): Promise<Trace> {
  const result = (await readRun(root, runId)).result;
  return traceResponse(root, await resultsRoot(root), runId, result, q);
}
