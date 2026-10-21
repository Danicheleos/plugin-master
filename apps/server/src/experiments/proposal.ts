import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Experiment } from '@pm/protocol';
import { resolveInSpace } from '../files/safe-path';

const day = () => new Date().toISOString().slice(0, 10);

/** The STATE.md addition proposed to the user; written only when the experiment is merged. */
export function buildProposal(e: Experiment): string {
  const a = e.analysis;
  return [
    `## Experiment ${e.id}: ${e.plan?.title ?? e.hypothesis ?? 'untitled'}`,
    a ? `Verdict: ${a.verdict} (recommendation: ${a.recommendation}).` : '',
    ...(a?.reasons ?? []).map((r) => `- ${r}`),
    ...(a?.cases ?? []).map((c) => `- ${c.case}: ${c.note}`),
  ].filter(Boolean).join('\n');
}

const append = async (root: string, name: string, text: string) => {
  const p = resolveInSpace(root, `.plugin-master/${name}`);
  await mkdir(dirname(p), { recursive: true });
  await appendFile(p, `\n${text}\n`);
};

/** After a successful merge of a loop experiment: STATE.md gets the proposal, DECISIONS.md an entry. */
export async function writeMergeNotes(root: string, e: Experiment): Promise<void> {
  if (!e.stateProposal) return;
  const desc = e.kind === 'description' ? e.candidates?.[e.descriptionResult?.bestIndex ?? 0] : undefined;
  await append(root, 'STATE.md', e.stateProposal);
  await append(
    root,
    'DECISIONS.md',
    [
      `## ${day()}: merged exp/${e.id} ${e.plan?.title ?? (desc ? `description of skill ${e.skill}` : '')}`.trim(),
      e.plan?.rationale ?? '',
      desc ? `Description changed (verdict ${e.descriptionResult?.verdict}): ${desc.text}` : '',
      e.analysis ? `Analyst: ${e.analysis.verdict}, ${e.analysis.recommendation}.` : '',
    ].filter(Boolean).join('\n'),
  );
}
