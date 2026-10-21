import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvalStatus } from '@pm/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTool } from '../plans/tools';
import { EVAL_ALLOWED_TOOLS, evalTools } from './tools';
import type { EvalRunner } from './runner';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pm-evaltools-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

function fake(status: EvalStatus = { state: 'idle' }) {
  const start = vi.fn(async () => ({ state: 'running', runId: 'r1' }) as EvalStatus);
  return { start, runner: { start, status: () => status } as unknown as EvalRunner };
}

describe('eval tools', () => {
  it('does not auto-allow eval_run', () => {
    expect(EVAL_ALLOWED_TOOLS).toEqual(['mcp__evals__eval_status']);
  });

  it('eval_run starts the runner with the parsed input and returns the run id', async () => {
    const f = fake();
    const t = evalTools('s1', root, f.runner);
    const out = await t.eval_run.run({ maxCostUsd: 2, tags: ['smoke'], runs: 2 });
    expect(f.start).toHaveBeenCalledWith('s1', root, { maxCostUsd: 2, tags: ['smoke'], runs: 2 });
    expect(out).toContain('r1');
  });

  it('eval_run rejects option-like values and returns runner/experiment errors as tool errors', async () => {
    const f = fake();
    const t = evalTools('s1', root, f.runner, () => true);
    const res = await runTool(() => t.eval_run.run({ maxCostUsd: 1 }));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/experiment/i);
    expect(f.start).not.toHaveBeenCalled();
    await expect(
      evalTools('s1', root, f.runner).eval_run.run({ maxCostUsd: 1, cases: ['-x'] }),
    ).rejects.toThrow();
  });

  it('eval_status reports idle, progress and the summed cost when finished', async () => {
    expect(await evalTools('s1', root, fake().runner).eval_status.run({})).toMatch(/No eval/);
    const status: EvalStatus = {
      state: 'done',
      runId: 'r1',
      progress: {
        total: 2,
        done: 2,
        current: null,
        cases: [
          { name: 'a', state: 'done', score: 1 },
          { name: 'b', state: 'failed' },
        ],
      },
    };
    for (const [dir, cost] of [['r1', 0.25], ['r1-2', 0.5]] as const) {
      await mkdir(join(root, 'evals/results', dir), { recursive: true });
      await writeFile(join(root, 'evals/results', dir, 'aggregate-result.json'), JSON.stringify({ costUsd: cost }));
    }
    const out = JSON.parse(await evalTools('s1', root, fake(status).runner).eval_status.run({}));
    expect(out).toMatchObject({ state: 'done', costUsd: 0.75, progress: { done: 2 } });
    expect(out.progress.cases[0]).toEqual({ name: 'a', state: 'done', score: 1 });
  });
});
