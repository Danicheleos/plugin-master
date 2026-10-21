import { parse } from 'yaml';
import {
  AnalysisSchema,
  ExecutionSummarySchema,
  HypothesisSchema,
  type Experiment,
  type RunExperiment,
} from '@pm/protocol';
import { listGroups, readGroup } from '../evals/results';
import { locked } from '../git/service';
import { splitFrontmatter } from '../hooks/service';
import { AppError } from '../lib/errors';
import { cut } from '../lib/text';
import { readConfig } from '../spaces/config-file';
import { descriptionBody, prepareDescription } from './description';
import { buildProposal } from './proposal';
import { type PermissionRequest } from './stages';
import { commitWorktree, evalOn, ignoreResults, now, stageKit, type LoopDeps, type Slot } from './kit';
import { appendLedger, changeTypeOf, diffStatOf, ledgerSummary, readLedger, skillsOf } from './ledger';
import { compare, comparisonText, failedTraces, summarizeEval } from './summary';
import { getExperiment, lockedExp, saveExperiment } from './store';
import { createExperiment, type Ctx } from './worktree';

export type { LoopDeps } from './kit';

/** Share of `maxCostUsd` the eval leaves for the analyst. */
const ANALYST_RESERVE = 0.1;
/** Eval runs per case when the request has none. */
const DEFAULT_RUNS = 3;
export const INTERRUPTED = 'interrupted (server restarted)';

/** Newest merged eval result of the space that covers `cases` (all of them, when given). */
async function latestResult(root: string, cases?: string[]) {
  for (const g of (await listGroups(root)).slice(0, 5)) {
    try {
      const { result } = await readGroup(root, g.id);
      const names = new Set(result.cases.map((c) => c.name));
      if (!cases?.length || cases.every((c) => names.has(c))) return { runId: g.id, result };
    } catch {
      /* unreadable group: try an older one */
    }
  }
  return undefined;
}

/** Frontmatter `hooks` of a Markdown text as a comparable string ('' = none; unparsable = the raw block). */
function fmHooks(text: string) {
  const fm = splitFrontmatter(text);
  if (!fm) return '';
  try {
    const h = (parse(fm.inner) as { hooks?: unknown } | null)?.hooks;
    return h == null ? '' : JSON.stringify(h);
  } catch {
    return fm.inner;
  }
}

/** Changed `.md` files whose frontmatter `hooks` at HEAD differ from `base` (eval runs them with --trust-plugin). */
const newHooks = (wt: string, base: string, files: string[]) =>
  locked(wt, async (git) => {
    const show = (ref: string, f: string) => git.show([`${ref}:${f}`]).catch(() => '');
    const out: string[] = [];
    for (const f of files.filter((f) => f.toLowerCase().endsWith('.md'))) {
      const h = fmHooks(await show('HEAD', f));
      if (h && h !== fmHooks(await show(base, f))) out.push(f);
    }
    return out;
  });

const pastText = (s: string) => (s ? `${s}\n\n` : '');

/** The experiment loop: hypothesis, execute, eval, analyze, then `ready` for the user to merge or discard. One per space. */
export function createExperimentLoop(d: LoopDeps) {
  const active = new Map<string, Slot>();

  async function body(spaceId: string, ctx: Ctx, slot: Slot, e0: Experiment, req: RunExperiment) {
    const { root } = ctx;
    const k = stageKit(d, spaceId, root, slot, e0, req.maxCostUsd);
    const { patch, begin, end, check, budget, sdk } = k;
    const { signal } = slot.ac;
    const focus = req.focus ? `Focus: ${req.focus}\n\n` : '';

    try {
      // 1. hypothesis (master, read-only, in the space)
      await begin('hypothesis');
      const latest = await latestResult(root, req.cases);
      const ledger = await readLedger(root);
      const h = await sdk(
        'master',
        root,
        `${focus}Latest eval result of this plugin:\n${latest ? summarizeEval(latest.result) : 'none yet'}\n\n${pastText(ledgerSummary(ledger))}Propose one hypothesis.`,
        HypothesisSchema,
      );
      await end('hypothesis', { runId: h.sessionId, costUsd: h.costUsd }, { plan: h.result, hypothesis: h.result.title });

      // 2. execute (executor in the worktree; permissions go to the UI)
      check();
      await begin('execute');
      const x = await sdk(
        'executor',
        e0.worktree,
        `Hypothesis:\n${JSON.stringify(h.result, null, 2)}\n\nApply it.`,
        ExecutionSummarySchema,
        {
          // the slot signal too: a cancelled stage must not leave its prompt pending
          onPermission: (r: PermissionRequest) =>
            d.permissions.request(spaceId, `Experiment ${e0.id} executor: ${r.toolName}`, r.input,
              AbortSignal.any([r.signal, signal]), `exp-${e0.id}-`),
        },
      );
      const files = await commitWorktree(e0.worktree, e0.base, `exp/${e0.id}: ${h.result.title}`.slice(0, 72));
      await end('execute', { runId: x.sessionId, costUsd: x.costUsd }, { execution: x.result, files });
      if (!files.length) throw new Error('executor made no changes');
      const hooked = await newHooks(e0.worktree, e0.base, files);
      if (
        hooked.length &&
        !(await d.permissions.request(spaceId, `Experiment ${e0.id}: run eval with new hooks in ${hooked.join(', ')}`,
          { files: hooked }, signal, `exp-${e0.id}-`))
      ) {
        check();
        throw new Error(`eval not approved: new hooks in ${hooked.join(', ')}`);
      }

      // 3. eval on the worktree; baseline = the space's latest result of the same cases
      check();
      await begin('eval');
      const remaining = budget(req.maxCostUsd * ANALYST_RESERVE);
      const baseline = await latestResult(root, req.cases);
      await ignoreResults(e0.worktree);
      const { result, runId, costUsd } = await evalOn(d, spaceId, root, e0.worktree, signal, {
        maxCostUsd: remaining,
        runs: req.runs ?? DEFAULT_RUNS,
        ...(req.cases?.length ? { cases: req.cases } : {}),
        ...(req.scaffold ? { scaffold: true } : {}),
      });
      check();
      const comparison = compare(result, baseline);
      await end('eval', { runId, costUsd }, { comparison });

      // 4. analyze (read-only, in the worktree)
      check();
      await begin('analyze');
      const traces = await failedTraces(e0.worktree, result);
      const a = await sdk(
        'analyst',
        e0.worktree,
        `Hypothesis: ${h.result.title}\nExpected: ${JSON.stringify(h.result.expectedEffect)}\n\n${comparisonText(comparison)}\n\n${pastText(ledgerSummary(ledger, skillsOf(files)))}Worktree eval:\n${summarizeEval(result, 3000)}\n\nFailed traces:\n${traces || 'none'}`,
        AnalysisSchema,
      );
      await end('analyze', { runId: a.sessionId, costUsd: a.costUsd }, { analysis: a.result });
      await appendLedger(root, {
        experiment: e0.id,
        kind: 'hypothesis',
        skills: skillsOf(files),
        files,
        changeType: changeTypeOf('hypothesis', files),
        hypothesis: h.result.title,
        diffSummary: cut(x.result.summary, 200),
        ...(await diffStatOf(e0.worktree, e0.base)),
        base: e0.base,
        evalRunIds: [...(baseline ? [baseline.runId] : []), runId],
        suite: comparison.suite,
        cases: comparison.cases.map(({ case: name, delta, n, flaky }) => ({ case: name, delta, n, flaky })),
        ...(a.result.lesson && { lesson: a.result.lesson }),
        costUsd: k.e.costUsd ?? 0,
      }).catch(d.onError);

      // 5. proposal: nothing is written to the main tree until the merge
      await patch({ status: 'ready', stage: 'proposal', stateProposal: buildProposal(k.e) });
    } catch (err) {
      await k.fail(err);
    }
  }

  return {
    /** Creates the experiment and returns it; the stages run in the background. */
    async run(spaceId: string, ctx: Ctx, req: RunExperiment): Promise<Experiment> {
      if (!(await readConfig(ctx.root)).evalTrusted)
        throw new AppError('EVAL_UNTRUSTED', 'Confirm that eval may run this plugin on this machine first', 409);
      const desc = req.kind === 'description';
      if (desc) await prepareDescription(ctx.root, req.skill!); // fails before anything is created
      // no await between the checks and the claim
      if (active.has(spaceId)) throw new AppError('EXPERIMENT_RUNNING', 'An experiment is already running', 409);
      if (d.evalRunner.status(spaceId).state === 'running')
        throw new AppError('EVAL_RUNNING', 'An eval is already running', 409);
      const slot: Slot = { n: 0, ac: new AbortController() };
      active.set(spaceId, slot);
      try {
        const created = await createExperiment(ctx);
        slot.n = created.id;
        slot.ac.signal.addEventListener('abort', () => {
          if (slot.stage !== 'eval') return;
          try {
            d.evalRunner.cancel(spaceId);
          } catch {
            /* the post-start check in the body covers this */
          }
        });
        const e = await lockedExp(ctx.root, () =>
          saveExperiment(ctx.root, {
            ...created,
            status: 'running',
            maxCostUsd: req.maxCostUsd,
            ...(req.focus && { focus: req.focus }),
            ...(req.cases?.length && { cases: req.cases }),
            ...(desc && {
              kind: 'description' as const,
              skill: req.skill,
              iterations: req.iterations ?? 3,
              hypothesis: `Optimize the description of skill ${req.skill}`,
            }),
          }),
        );
        d.onChange(spaceId);
        void (desc ? descriptionBody(d, spaceId, ctx.root, slot, e, req) : body(spaceId, ctx, slot, e, req))
          .catch(d.onError)
          .finally(() => active.get(spaceId) === slot && active.delete(spaceId));
        return e;
      } catch (err) {
        active.delete(spaceId);
        throw err;
      }
    },

    cancel(spaceId: string, n: number): void {
      const s = active.get(spaceId);
      if (s?.n !== n) throw new AppError('EXPERIMENT_NOT_RUNNING', `Experiment ${n} is not running`, 409);
      s.ac.abort();
    },

    /** Merge and discard of a running experiment are refused. */
    assertIdle(spaceId: string, n: number): void {
      if (active.get(spaceId)?.n === n)
        throw new AppError('EXPERIMENT_RUNNING', `Experiment ${n} is running`, 409);
    },

    /** Whether an experiment runs in the space (normal evals are refused meanwhile). */
    busy: (spaceId: string) => active.has(spaceId),

    /** A `running` record that is not in the in-memory slot was left by a crash: persisted as failed. */
    async settle(spaceId: string, root: string, e: Experiment): Promise<Experiment> {
      const stale = (x: Experiment) => x.status === 'running' && active.get(spaceId)?.n !== x.id;
      if (!stale(e)) return e;
      return lockedExp(root, async () => {
        const cur = await getExperiment(root, e.id);
        return stale(cur)
          ? saveExperiment(root, { ...cur, status: 'failed', error: INTERRUPTED, updatedAt: now() })
          : cur;
      });
    },

    close(): void {
      active.forEach((s) => s.ac.abort());
    },
  };
}

export type ExperimentLoop = ReturnType<typeof createExperimentLoop>;
