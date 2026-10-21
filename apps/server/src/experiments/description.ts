import { readFile, writeFile } from 'node:fs/promises';
import {
  DescriptionProposalSchema,
  MAX_DESCRIPTION,
  UNSAFE_DESCRIPTION,
  parseSkill,
  setDescription,
  splitTriggerCases,
  type DescriptionCandidate,
  type EvalResult,
  type Experiment,
  type RunExperiment,
} from '@pm/protocol';
import { mean } from '../evals/results';
import { readSuite } from '../evals/suite';
import { resolveInSpace } from '../files/safe-path';
import { AppError } from '../lib/errors';
import { DESCRIPTION_STAGE } from './prompts';
import { commitWorktree, evalOn, ignoreResults, stageKit, sumCost, type LoopDeps, type Slot } from './kit';
import { appendLedger, diffStatOf, ledgerSummary, readLedger } from './ledger';
import { caseScore, compare, failedTraces, summarizeEval } from './summary';

const RUNS = 3;
const skillPath = (skill: string) => `skills/${skill}/SKILL.md`;

/** The skill's current description and the trigger cases (names) of the plugin at `dir`; throws a 400/409 when unusable. */
export async function prepareDescription(dir: string, skill: string) {
  const text = await readFile(resolveInSpace(dir, skillPath(skill)), 'utf8').catch(() => null);
  if (text === null) throw new AppError('SKILL_NOT_FOUND', `No skills/${skill}/SKILL.md`, 404);
  const data = parseSkill(text).frontmatter?.data as { description?: unknown } | null | undefined;
  const description = typeof data?.description === 'string' ? data.description : '';
  const cases = splitTriggerCases((await readSuite(dir)).cases);
  if (!cases.train.length)
    throw new AppError('NO_TRIGGER_CASES', 'No trigger cases: tag eval cases with "trigger" (and some with "holdout")', 400);
  return { text, description, ...cases };
}

/** Why a proposed description cannot be tried, else undefined. */
export const descriptionGate = (text: string) =>
  !text
    ? 'empty description'
    : text.length > MAX_DESCRIPTION
      ? `description is ${text.length} chars (max ${MAX_DESCRIPTION})`
      : UNSAFE_DESCRIPTION.test(text)
        ? 'description must be a single line without control characters'
        : undefined;

/** Mean case score of `names` (a case missing from the result counts 0); undefined when there are no names. */
const score = (r: EvalResult, names: string[]) =>
  names.length
    ? mean(names.map((n) => { const c = r.cases.find((x) => x.name === n); return c ? (caseScore(c) ?? 0) : 0; }))
    : undefined;

/** Best train score; ties: shorter text, then earlier. */
export function pickBest(c: DescriptionCandidate[]): number {
  let best = 0;
  c.forEach((x, i) => {
    const b = c[best]!;
    if ((x.train ?? 0) > (b.train ?? 0) || ((x.train ?? 0) === (b.train ?? 0) && x.text.length < b.text.length)) best = i;
  });
  return best;
}

/** The description optimizer of one skill: baseline eval, then N rounds of propose, write, eval; ends `ready` with the best candidate in the worktree. */
export async function descriptionBody(d: LoopDeps, spaceId: string, root: string, slot: Slot, e0: Experiment, req: RunExperiment) {
  const skill = req.skill!;
  const n = req.iterations ?? 3;
  let banked = 0;
  const k = stageKit(d, spaceId, root, slot, e0, req.maxCostUsd, (e) => banked + sumCost(e.stages));
  const wt = e0.worktree;
  const warnings: string[] = [];
  try {
    const prep = await prepareDescription(wt, skill);
    const { train, holdout } = prep;
    const file = resolveInSpace(wt, skillPath(skill));
    const skillDir = resolveInSpace(wt, `skills/${skill}`);
    await ignoreResults(wt);
    await k.patch({ trainCases: train, holdoutCases: holdout });

    const candidates: DescriptionCandidate[] = [];
    /** eval result per candidate */
    const results: EvalResult[] = [];
    const ledger = await readLedger(root);
    const rejected: string[] = [];
    /** Evals `text` (already written and committed) as one candidate. */
    const evaluate = async (text: string, proposeRunId?: string) => {
      k.check();
      await k.begin('eval');
      const r = await evalOn(d, spaceId, root, wt, slot.ac.signal, { maxCostUsd: k.budget(), cases: [...train, ...holdout], runs: req.runs ?? RUNS, ...(req.scaffold && { scaffold: true }) });
      await k.end('eval', { runId: r.runId, costUsd: r.costUsd });
      candidates.push({
        text,
        train: score(r.result, train),
        holdout: score(r.result, holdout),
        costUsd: sumCost(k.e.stages),
        evalRunId: r.runId,
        ...(proposeRunId && { proposeRunId }),
      });
      results.push(r.result);
      banked += sumCost(k.e.stages);
      await k.patch({ candidates, stages: {}, costUsd: banked });
      return r.result;
    };

    let onDisk = prep.description;
    let last = await evaluate(prep.description);
    for (let it = 1; it <= n; it++) {
      k.check();
      try {
        k.budget();
      } catch {
        warnings.push(`cost cap reached after ${it - 1} of ${n} iterations`);
        break;
      }
      await k.begin('propose');
      const tried = candidates.map((c, i) => `${i === 0 ? 'original' : `candidate ${i}`} (train ${c.train?.toFixed(2)}): ${c.text}`);
      const traces = await failedTraces(wt, last, { names: train, count: 3, perCase: 300, total: 900 });
      const prompt = [
        `Skill: ${skill}`,
        `Current description (${candidates.at(-1)!.text.length} chars):\n${candidates.at(-1)!.text}`,
        `Descriptions tried so far:\n${tried.join('\n')}`,
        rejected.length ? `Rejected proposals (do not repeat):\n${rejected.join('\n')}` : '',
        `Trigger cases of the current description (score 0..1 and failed graders):\n${summarizeEval({ ...last, cases: last.cases.filter((c) => train.includes(c.name)) }) || 'none'}`,
        traces ? `Failed trigger case traces (tail excerpts):\n${traces}` : '',
        ledgerSummary(ledger, [skill]),
        'Propose the improved description.',
      ].filter(Boolean).join('\n\n');
      const p = await k.sdk('master', skillDir, prompt, DescriptionProposalSchema, { systemPrompt: DESCRIPTION_STAGE });
      const text = p.result.description.trim();
      const bad = descriptionGate(text) ?? (candidates.some((c) => c.text === text) ? 'same as an earlier description' : undefined);
      await k.end('propose', { runId: p.sessionId, costUsd: p.costUsd });
      if (bad) {
        rejected.push(`- ${bad}: ${text.slice(0, 120)}`);
        banked += sumCost(k.e.stages);
        await k.patch({ stages: {}, costUsd: banked });
        continue;
      }
      await writeFile(file, setDescription(await readFile(file, 'utf8'), text));
      onDisk = text;
      const files = await commitWorktree(wt, e0.base, `exp/${e0.id}: description iteration ${it}`);
      if (files.some((f) => f !== skillPath(skill))) throw new Error(`unexpected changes: ${files.join(', ')}`);
      try {
        k.budget();
      } catch {
        warnings.push(`cost cap reached before the eval of iteration ${it}`);
        banked += sumCost(k.e.stages);
        break;
      }
      last = await evaluate(text, p.sessionId);
    }

    const bestIndex = pickBest(candidates);
    const best = candidates[bestIndex]!;
    const orig = candidates[0]!;
    if (best.text !== onDisk) {
      await writeFile(file, setDescription(await readFile(file, 'utf8'), best.text));
      await commitWorktree(wt, e0.base, `exp/${e0.id}: description best (candidate ${bestIndex})`);
    }
    let verdict: 'pass' | 'fail' | 'unknown' = 'unknown';
    if (!holdout.length)
      warnings.push('no holdout cases (tag some trigger cases "holdout"): overfitting cannot be checked');
    else if (bestIndex === 0) {
      verdict = 'fail';
      warnings.push('no candidate scored higher on train than the original');
    } else verdict = (best.holdout ?? 0) >= (orig.holdout ?? 0) ? 'pass' : 'fail';
    const f = (x?: number) => (x === undefined ? 'n/a' : x.toFixed(2));
    const origRun = orig.evalRunId;
    const comparison = compare(results[bestIndex]!, origRun ? { runId: origRun, result: results[0]! } : undefined);
    await appendLedger(root, {
      experiment: e0.id,
      kind: 'description',
      skills: [skill],
      files: [skillPath(skill)],
      changeType: 'description',
      hypothesis: e0.hypothesis ?? `Optimize the description of skill ${skill}`,
      diffSummary: bestIndex === 0 ? 'unchanged (the original scored best)' : `description: ${best.text.slice(0, 160)}`,
      ...(await diffStatOf(wt, e0.base)),
      base: e0.base,
      evalRunIds: [...new Set([origRun, best.evalRunId].flatMap((x) => x ?? []))],
      suite: comparison.suite,
      cases: comparison.cases.map(({ case: name, delta, n, flaky }) => ({ case: name, delta, n, flaky })),
      holdout: { before: orig.holdout, after: best.holdout },
      lesson: `Candidate ${bestIndex}: train ${f(orig.train)} -> ${f(best.train)}, holdout ${f(orig.holdout)} -> ${f(best.holdout)} (${verdict}).`,
      costUsd: banked,
    }).catch(d.onError);
    await k.patch({
      status: 'ready',
      stage: 'proposal',
      costUsd: banked,
      descriptionResult: { bestIndex, verdict, ...(warnings.length && { warning: warnings.join('; ') }) },
      files: [skillPath(skill)],
      stateProposal: [
        `## Experiment ${e0.id}: description of skill ${skill}`,
        `Verdict: ${verdict}. Train ${f(orig.train)} -> ${f(best.train)}, holdout ${f(orig.holdout)} -> ${f(best.holdout)}.`,
        ...warnings.map((w) => `- ${w}`),
      ].join('\n'),
    });
  } catch (err) {
    await k.fail(err);
  }
}
