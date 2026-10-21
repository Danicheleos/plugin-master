import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  EvalResultSchema,
  type EvalCaseState,
  type EvalProgress,
  type EvalLine,
  EvalRunRequest,
  EvalState,
  EvalStatus,
} from '@pm/protocol';
import { resolveInSpace } from '../files/safe-path';
import { AppError } from '../lib/errors';
import { readConfig } from '../spaces/config-file';
import type { Hub } from '../ws/hub';
import { evalDir } from './eval-dir';
import { readSuite } from './suite';
import { writeSidecar } from '../versions/sidecar';
import { harvestTraces, keptPaths } from './traces';

const MAX_LINES = 500;
const RESULT_FILE = 'aggregate-result.json';

export type EvalProcess = Pick<
  ChildProcess,
  'stdout' | 'stderr' | 'on' | 'kill'
>;
export type Spawner = (
  cmd: string,
  args: string[],
  opts: { cwd: string; shell: false; stdio: ['ignore', 'pipe', 'pipe'] },
) => EvalProcess;

const realSpawn: Spawner = (cmd, args, opts) => spawn(cmd, args, opts);

/** The target comes first: `--tag <tag...>` style options must not swallow it. Request values are validated by the schema. */
export function buildArgs(
  root: string,
  out: string,
  req: EvalRunRequest,
  trusted: boolean,
): string[] {
  return [
    'plugin',
    'eval',
    root,
    '--json',
    join(out, RESULT_FILE),
    '--output-dir',
    out,
    '--no-publish',
    '--keep-temp', // sandbox traces are copied out after the run (traces.ts)
    '--max-cost-usd',
    String(req.maxCostUsd),
    ...(req.cases?.length ? ['--case', req.cases[0]] : []),
    ...(req.tags ?? []).flatMap((t) => ['--tag', t]),
    ...(req.runs ? ['--runs', String(req.runs)] : []),
    ...(req.model ? ['--model', req.model] : []),
    '--ablation',
    req.ablation ? 'with-without' : 'none',
    ...(req.allowTools?.length ? ['--allow-tools', ...req.allowTools] : []),
    ...(req.scaffold ? ['--scaffold'] : []),
    ...(trusted ? ['--trust-plugin'] : []),
  ];
}

/** One invocation per selected case; the cost limit is split between them. */
function invocations(req: EvalRunRequest, out: string) {
  const cases = req.cases ?? [];
  if (cases.length < 2) return [{ req, out }];
  const maxCostUsd = Math.round((req.maxCostUsd / cases.length) * 1e4) / 1e4 || 0.0001;
  return cases.map((c, i) => ({
    req: { ...req, cases: [c], maxCostUsd },
    out: i === 0 ? out : `${out}-${i + 1}`,
  }));
}

/** Names the CLI's `--case` glob would match literally and the schema accepts as values. */
const plainName = (n: string) => !/^-|[*?[\]{}\0]/.test(n);

/**
 * Cases a run without `cases` is expanded to (one invocation each, so progress is per case):
 * all parsable suite cases, narrowed by `tags` (any). Empty = keep one invocation for everything.
 */
async function suiteCases(target: string, req: EvalRunRequest): Promise<string[]> {
  if (req.cases?.length) return [];
  const { cases } = await readSuite(target).catch(() => ({ cases: [] }));
  const names = [
    ...new Set(
      cases
        .filter((c) => !c.error)
        .filter((c) => !req.tags?.length || c.tags.some((t) => req.tags?.includes(t)))
        .map((c) => c.name),
    ),
  ];
  return names.every(plainName) ? names : [];
}

/** Score of one invocation from its aggregate file; undefined when missing or unreadable. */
async function readScore(out: string): Promise<number | undefined> {
  try {
    const raw = JSON.parse(await readFile(join(out, RESULT_FILE), 'utf8'));
    return EvalResultSchema.parse(raw).aggregates.overallScore;
  } catch {
    return undefined;
  }
}

type Run = {
  lines: EvalLine[];
  status: EvalStatus;
  proc?: EvalProcess;
  cancelling: boolean;
  /** resolves with the final status */
  done: Promise<EvalStatus>;
};

export function createEvalRunner(
  hub: Pick<Hub, 'broadcast' | 'onSubscribe'>,
  spawner: Spawner = realSpawn,
) {
  const runs = new Map<string, Run>();
  const idle: EvalStatus = { state: 'idle' };
  const get = (spaceId: string) =>
    runs.get(spaceId) ?? { lines: [], status: idle, cancelling: false, done: Promise.resolve(idle) };

  const setStatus = (spaceId: string, run: Run, status: EvalStatus) => {
    run.status = status;
    hub.broadcast(spaceId, { type: 'eval.status', spaceId, ...status });
  };

  const addLine = (spaceId: string, run: Run, e: EvalLine) => {
    run.lines.push(e);
    if (run.lines.length > MAX_LINES) run.lines.shift();
    hub.broadcast(spaceId, { type: 'eval.output', spaceId, ...e });
  };

  hub.onSubscribe((spaceId, client) => {
    const { lines, status } = get(spaceId);
    if (status.state === 'idle') return;
    client.send({ type: 'eval.history', spaceId, lines, status });
  });

  /** Turns the stream into lines; the unfinished tail is emitted by `flush`. */
  function lineSplitter(
    stream: EvalLine['stream'],
    emit: (e: EvalLine) => void,
  ) {
    let tail = '';
    return {
      push(chunk: Buffer | string) {
        const parts = (tail + String(chunk)).split(/\r?\n/);
        tail = parts.pop() ?? '';
        parts.forEach((line) => emit({ line, stream }));
      },
      flush() {
        if (tail) emit({ line: tail, stream });
        tail = '';
      },
    };
  }

  async function exitState(
    run: Run,
    out: string,
    code: number | null,
  ): Promise<EvalState> {
    if (run.cancelling || code === 130) return 'cancelled';
    if (code === 0) return 'done';
    if (code === 1 || code === 2) {
      const written = await stat(join(out, RESULT_FILE)).then(
        (s) => s.isFile(),
        () => false,
      );
      return written ? 'done' : 'failed';
    }
    return 'failed';
  }

  return {
    status: (spaceId: string) => get(spaceId).status,

    async start(
      spaceId: string,
      root: string,
      req: EvalRunRequest,
      /** dir the eval runs on (an experiment worktree); trust is still the space's */
      target = root,
    ): Promise<EvalStatus> {
      if (runs.get(spaceId)?.status.state === 'running')
        throw new AppError('EVAL_RUNNING', 'An eval is already running', 409);
      const trusted = (await readConfig(root)).evalTrusted;
      if (!trusted)
        throw new AppError(
          'EVAL_UNTRUSTED',
          'Confirm that eval may run this plugin on this machine first',
          409,
        );
      const expanded = await suiteCases(target, req);
      if (expanded.length) req = { ...req, cases: expanded };
      const runId = new Date().toISOString().replace(/:/g, '-');
      const out = resolveInSpace(
        target,
        `${await evalDir(target)}/results/${runId}`,
      );
      // re-check: the awaits above let a concurrent start in
      if (runs.get(spaceId)?.status.state === 'running')
        throw new AppError('EVAL_RUNNING', 'An eval is already running', 409);

      let finish!: (s: EvalStatus) => void;
      const run: Run = { lines: [], status: idle, cancelling: false, done: new Promise((r) => (finish = r)) };
      runs.set(spaceId, run);
      const startedAt = new Date().toISOString();
      const running: EvalStatus = { state: 'running', runId, startedAt };
      // `--case` takes one glob (braces are not supported): several cases = one invocation each
      const jobs = invocations(req, out);
      const names = jobs.flatMap((j) => j.req.cases ?? []);
      const progress: EvalProgress | undefined = names.length
        ? { total: names.length, done: 0, current: null, cases: names.map((name) => ({ name, state: 'queued' as const })) }
        : undefined;
      const publish = (state: EvalStatus = running) =>
        setStatus(spaceId, run, {
          ...state,
          ...(progress && { progress: structuredClone(progress) }),
        });
      const mark = (i: number, state: EvalCaseState, score?: number) => {
        if (!progress) return;
        progress.cases[i] = { name: progress.cases[i].name, state, ...(score !== undefined && { score }) };
        progress.done = progress.cases.filter((c) => c.state !== 'queued' && c.state !== 'running').length;
        progress.current = progress.cases.find((c) => c.state === 'running')?.name ?? null;
      };
      publish();

      let seen: string[] = []; // output lines of the current invocation
      const emit = (e: EvalLine) => {
        seen.push(e.line);
        addLine(spaceId, run, e);
      };
      const fail = (message: string) =>
        emit({ line: message, stream: 'stderr' });

      /** One CLI invocation; resolves with its exit code (null: failed to start). */
      const invoke = (args: string[]) =>
        new Promise<number | null>((resolve) => {
          let proc: EvalProcess;
          try {
            proc = spawner('claude', args, {
              cwd: target,
              shell: false,
              stdio: ['ignore', 'pipe', 'pipe'], // the CLI must never wait for TTY input
            });
          } catch (e) {
            fail(`Failed to start claude: ${e instanceof Error ? e.message : e}`);
            return resolve(null);
          }
          run.proc = proc;
          const splitters = [
            lineSplitter('stdout', emit),
            lineSplitter('stderr', emit),
          ];
          proc.stdout?.on('data', (c: Buffer) => splitters[0].push(c));
          proc.stderr?.on('data', (c: Buffer) => splitters[1].push(c));
          proc.on('error', (e: NodeJS.ErrnoException) => {
            fail(
              e.code === 'ENOENT'
                ? 'Failed to start: the `claude` command was not found. Install Claude Code and make sure it is on PATH.'
                : `Failed to start claude: ${e.message}`,
            );
            resolve(null);
          });
          proc.on('close', (code: number | null) => {
            splitters.forEach((s) => s.flush());
            resolve(code);
          });
        });

      void (async () => {
        const states: EvalState[] = [];
        let code: number | null = null;
        try {
          for (const [i, job] of jobs.entries()) {
            if (run.cancelling) break;
            seen = [];
            if (job.req.cases?.length) {
              mark(i, 'running');
              publish();
            }
            await writeSidecar(target, spaceId, job.out, new Date().toISOString());
            if (run.cancelling) break; // cancelled while the sidecar was written (no process yet)
            code = await invoke(buildArgs(target, job.out, job.req, trusted));
            // sandbox paths the CLI printed (a failed run has no aggregate to list them)
            await harvestTraces(job.out, (line) => emit({ line, stream: 'stderr' }), keptPaths(seen));
            const st = await exitState(run, job.out, code);
            states.push(st);
            if (job.req.cases?.length) mark(i, st === 'done' ? 'done' : st === 'cancelled' ? 'cancelled' : 'failed', await readScore(job.out));
          }
        } catch (e) {
          fail(`Eval run failed: ${e instanceof Error ? e.message : e}`);
        }
        const state: EvalState = states.includes('cancelled') || run.cancelling
          ? 'cancelled'
          : states.some((s) => s === 'done')
            ? 'done'
            : 'failed';
        progress?.cases.forEach((c, i) => c.state === 'queued' || c.state === 'running' ? mark(i, state === 'failed' ? 'failed' : 'cancelled') : undefined);
        const final: EvalStatus = { ...running, state, ...(code !== null && { exitCode: code }), ...(progress && { progress: structuredClone(progress) }) };
        setStatus(spaceId, run, final);
        finish(final);
      })();
      return running;
    },

    /** Final status of the current (or last) run of the space. */
    finished: (spaceId: string): Promise<EvalStatus> => get(spaceId).done,

    /** SIGINT: eval writes the partial results and exits 130. */
    cancel(spaceId: string): void {
      const run = runs.get(spaceId);
      if (run?.status.state !== 'running')
        throw new AppError('EVAL_NOT_RUNNING', 'No eval is running', 409);
      run.cancelling = true;
      run.proc?.kill('SIGINT');
    },

    close(): void {
      for (const run of runs.values())
        if (run.status.state === 'running') run.proc?.kill('SIGTERM');
    },
  };
}

export type EvalRunner = ReturnType<typeof createEvalRunner>;
