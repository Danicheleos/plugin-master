import { z } from 'zod';
import type { EvalRunRequest, Experiment, LoopStage, StageInfo, StageRole } from '@pm/protocol';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { evalDir } from '../evals/eval-dir';
import { readGroup, readMerged } from '../evals/results';
import { resolveInSpace } from '../files/safe-path';
import { locked } from '../git/service';
import type { Permissions } from '../claude/permissions';
import type { EvalRunner } from '../evals/runner';
import type { Recorder } from '../runs/recorder';
import { runStage, StageError, type StageQuery } from './stages';
import { lockedExp, saveExperiment } from './store';

export type LoopDeps = {
  evalRunner: EvalRunner;
  permissions: Permissions;
  recorder: Recorder;
  /** after every persisted change of a record */
  onChange: (spaceId: string) => void;
  onError: (e: unknown) => void;
  queryFn?: StageQuery;
};

export type Slot = { n: number; ac: AbortController; stage?: LoopStage };

export const now = () => new Date().toISOString();
export const sumCost = (stages: Experiment['stages']) =>
  Object.values(stages ?? {}).reduce((n, s) => n + (s.costUsd ?? 0), 0);

/**
 * Persistence and budget helpers shared by the loops. `total` = what the record has spent so far
 * (given the record with its updated `stages`): the stage sum for the master loop, banked iterations plus it for the optimizer.
 */
export function stageKit(
  d: LoopDeps,
  spaceId: string,
  root: string,
  slot: Slot,
  e0: Experiment,
  maxCostUsd: number,
  total: (e: Experiment) => number = (e) => sumCost(e.stages),
) {
  const { signal } = slot.ac;
  let e = e0;
  const patch = async (p: Partial<Experiment>) => {
    e = await lockedExp(root, () => saveExperiment(root, { ...e, ...p, updatedAt: now() }));
    d.onChange(spaceId);
  };
  const begin = (stage: LoopStage) => {
    slot.stage = stage;
    return patch({ stage, stages: { ...e.stages, [stage]: { startedAt: now() } } });
  };
  const end = (stage: LoopStage, info: Partial<StageInfo>, extra: Partial<Experiment> = {}) => {
    const stages = { ...e.stages, [stage]: { ...(e.stages?.[stage] as StageInfo), endedAt: now(), ...info } };
    return patch({ stages, costUsd: total({ ...e, stages }), ...extra });
  };
  const check = () => {
    if (signal.aborted) throw new Error('cancelled');
  };
  /** What is left of the cap after `reserve`; throws when nothing is. */
  const budget = (reserve = 0) => {
    const spent = total(e);
    const left = maxCostUsd - spent - reserve;
    if (left <= 0) throw new Error(`cost cap exhausted ($${spent.toFixed(2)} of $${maxCostUsd})`);
    return left;
  };
  const sdk = <S extends z.ZodType>(role: StageRole, cwd: string, prompt: string, schema: S, extra: object = {}) =>
    runStage<S>({
      role, cwd, spaceRoot: root, prompt, schema, recorder: d.recorder, signal, queryFn: d.queryFn,
      maxBudgetUsd: budget(), ...extra,
    });
  /** Persists the failure (or the cancel) on the running stage, keeping the cost a failed stage reported. */
  const fail = async (err: unknown) => {
    const message = signal.aborted ? 'cancelled' : err instanceof Error ? err.message : String(err);
    const cur = slot.stage && e.stages?.[slot.stage];
    const spent = err instanceof StageError && err.costUsd !== undefined ? { costUsd: err.costUsd } : {};
    const stages = cur
      ? { ...e.stages, [slot.stage!]: { ...cur, endedAt: cur.endedAt ?? now(), error: message, ...spent } }
      : e.stages;
    await patch({ status: 'failed', error: message, stages, costUsd: total({ ...e, stages }) }).catch(d.onError);
  };
  return { get e() { return e; }, patch, begin, end, check, budget, sdk, fail };
}

/** Runs an eval of `wt` (the experiment worktree) to its end; cancels it when `signal` aborts. */
export async function evalOn(d: LoopDeps, spaceId: string, root: string, wt: string, signal: AbortSignal, req: EvalRunRequest) {
  const started = await d.evalRunner.start(spaceId, root, req, wt);
  if (signal.aborted) {
    try {
      d.evalRunner.cancel(spaceId);
    } catch {
      /* not running anymore */
    }
  }
  const fin = await d.evalRunner.finished(spaceId);
  if (signal.aborted) throw new Error('cancelled');
  if (fin.state !== 'done') throw new Error(`eval run ${fin.state}${fin.exitCode ? ` (exit ${fin.exitCode})` : ''}`);
  // evals in one worktree start close together and would merge into one group: keep this eval's invocations only
  const runId = started.runId!;
  const { group } = await readGroup(wt, runId);
  const runs = group.runs.filter((r) => r.id === runId || r.id.startsWith(`${runId}-`));
  const result = await readMerged(wt, { ...group, runIds: runs.map((r) => r.id), runs });
  return { result, runId, costUsd: runs.reduce((n, r) => n + (r.costUsd ?? 0), 0) };
}

/** Commits what the executor left in the worktree; returns the files changed since `base`. */
export const commitWorktree = (wt: string, base: string, message: string) =>
  locked(wt, async (git) => {
    if ((await git.status()).files.length) {
      await git.raw(['add', '-A']);
      await git.raw(['commit', '-m', message]);
    }
    return (await git.raw(['diff', '--name-only', '-z', '--no-renames', base, 'HEAD'])).split('\0').filter(Boolean);
  });

/** Eval output of the worktree must never reach a merge: the results dir ignores itself. */
export async function ignoreResults(wt: string) {
  const p = resolveInSpace(wt, `${await evalDir(wt)}/results/.gitignore`);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, '*\n', { flag: 'wx' }).catch(() => undefined);
}

