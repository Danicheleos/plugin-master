import { EvalResultSchema, EvalRunRequestSchema, type EvalStatus } from '@pm/protocol';
import { readFile } from 'node:fs/promises';
import { AppError } from '../lib/errors';
import { def, createToolServer } from '../plans/tools';
import { evalDir, RESULT_FILE } from './eval-dir';
import type { EvalRunner } from './runner';
import { resolveInSpace } from '../files/safe-path';

export const EVAL_SERVER = 'evals';

/** `eval_run` costs money: it is not listed here, so it goes through `canUseTool` (the user's prompt). */
export const EVAL_ALLOWED_TOOLS = [`mcp__${EVAL_SERVER}__eval_status`];

const RunInput = EvalRunRequestSchema.omit({ ablation: true });

/** Plain handlers (tests call them without the SDK). `busy`: an experiment runs in the space. */
export function evalTools(
  spaceId: string,
  root: string,
  runner: EvalRunner,
  busy: (spaceId: string) => boolean = () => false,
) {
  /** Total cost of the run's invocations (`<id>`, `<id>-2`, ...); undefined when no aggregate is readable. */
  async function totalCost(status: EvalStatus) {
    if (!status.runId) return undefined;
    const base = `${await evalDir(root)}/results/${status.runId}`;
    const n = Math.max(1, status.progress?.total ?? 1);
    let sum: number | undefined;
    for (let i = 1; i <= n; i++) {
      const cost = await readFile(
        resolveInSpace(root, `${base}${i > 1 ? `-${i}` : ''}/${RESULT_FILE}`),
        'utf8',
      )
        .then((r) => EvalResultSchema.parse(JSON.parse(r)).costUsd)
        .catch(() => undefined);
      if (cost !== undefined) sum = (sum ?? 0) + cost;
    }
    return sum;
  }

  return {
    eval_run: def(
      'Start `claude plugin eval` through the app (progress is shown to the user). Returns at once with the run id: poll eval_status. Costs money: set maxCostUsd (split evenly between cases). Without cases/tags all suite cases run, one invocation each.',
      {
        cases: RunInput.shape.cases,
        tags: RunInput.shape.tags,
        runs: RunInput.shape.runs,
        model: RunInput.shape.model,
        maxCostUsd: RunInput.shape.maxCostUsd,
      },
      async (a) => {
        if (busy(spaceId))
          throw new AppError('EXPERIMENT_RUNNING', 'An experiment is running in this space', 409);
        const req = RunInput.parse(a);
        const s = await runner.start(spaceId, root, req);
        return `Eval started: run ${s.runId}. Poll eval_status until the state is not "running".`;
      },
    ),
    eval_status: def(
      'Status of the current or last eval run: state, per-case progress and scores; when finished also the cost.',
      {},
      async () => {
        const status = runner.status(spaceId);
        if (status.state === 'idle') return 'No eval has run since the server started.';
        const cost = status.state === 'running' ? undefined : await totalCost(status);
        return JSON.stringify({ ...status, ...(cost !== undefined && { costUsd: cost }) }, null, 2);
      },
    ),
  };
}

export const createEvalMcpServer = (
  spaceId: string,
  root: string,
  runner: EvalRunner,
  busy?: (spaceId: string) => boolean,
) => createToolServer(EVAL_SERVER, evalTools(spaceId, root, runner, busy));
