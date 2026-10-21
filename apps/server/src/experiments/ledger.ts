import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  LedgerOutcomeSchema,
  LedgerRecordSchema,
  type ChangeType,
  type Experiment,
  type LedgerRecord,
} from '@pm/protocol';
import { resolveInSpace } from '../files/safe-path';
import { locked } from '../git/service';
import { cut } from '../lib/text';

const FILE = '.plugin-master/ledger.jsonl';
const path = (root: string) => resolveInSpace(root, FILE);
/** Hard cap of the prompt summary. */
const SUMMARY_CAP = 1500;
const RECENT = 8;

/** One append of one line (atomic enough for lines this size); the file is never rewritten. */
async function appendLine(root: string, v: object) {
  await mkdir(dirname(path(root)), { recursive: true });
  await appendFile(path(root), `${JSON.stringify(v)}\n`);
}

/** Records in file order with the latest merge/rollback folded into `merged`; corrupt lines are skipped. */
export async function readLedger(root: string): Promise<LedgerRecord[]> {
  const text = await readFile(path(root), 'utf8').catch(() => '');
  const records: LedgerRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    const rec = LedgerRecordSchema.safeParse(json);
    if (rec.success) {
      records.push(rec.data);
      continue;
    }
    const out = LedgerOutcomeSchema.safeParse(json);
    if (!out.success) continue;
    for (let i = records.length - 1; i >= 0; i--)
      if (records[i]!.experiment === out.data.experiment) {
        records[i]!.merged = out.data.merged;
        break;
      }
  }
  return records;
}

export const appendLedger = (root: string, r: Omit<LedgerRecord, 'id' | 'at' | 'merged'>) =>
  appendLine(root, LedgerRecordSchema.parse({ ...r, id: randomUUID(), at: new Date().toISOString(), merged: null }));

/** The user merged (true) or discarded (false) the experiment. */
export const recordOutcome = (root: string, experiment: number, merged: boolean) =>
  appendLine(root, { event: 'outcome', experiment, merged, at: new Date().toISOString() });

const skillOf = (f: string) => /^skills\/([^/]+)\//.exec(f)?.[1];

/** Skills a change touched (by path). */
export const skillsOf = (files: string[]) => [...new Set(files.flatMap((f) => skillOf(f) ?? []))].sort();

const typeOf = (f: string): ChangeType =>
  /(^|\/)hooks\/|hooks\.json$/.test(f) ? 'hooks'
  : /^(scripts|bin)\//.test(f) ? 'scripts'
  : /example/i.test(f) ? 'examples'
  : /\.md$/i.test(f) ? 'instructions'
  : 'other';

/** Cheap guess from the changed paths: one category, else `structure` (several kinds, or files moved around). */
export function changeTypeOf(kind: Experiment['kind'], files: string[]): ChangeType {
  if (kind === 'description') return 'description';
  const types = new Set(files.map(typeOf));
  return types.size === 1 ? [...types][0]! : types.size > 1 ? 'structure' : 'other';
}

/** Files, additions and deletions of the worktree HEAD against `base`, plus HEAD itself. */
export const diffStatOf = (wt: string, base: string) =>
  locked(wt, async (git) => {
    const rows = (await git.raw(['diff', '--numstat', '--no-renames', base, 'HEAD'])).split('\n').filter(Boolean);
    const num = (s: string | undefined) => Number(s) || 0; // binary files show '-'
    return {
      head: (await git.raw(['rev-parse', 'HEAD'])).trim(),
      diffStat: {
        files: rows.length,
        additions: rows.reduce((n, r) => n + num(r.split('\t')[0]), 0),
        deletions: rows.reduce((n, r) => n + num(r.split('\t')[1]), 0),
      },
    };
  });

const fmt = (n?: number) => (n === undefined ? 'n/a' : (n >= 0 ? '+' : '') + n.toFixed(2));

/** `improved +0.25 [+0.10, +0.40]`, or just the verdict when there is no interval. */
export const verdictText = (r: LedgerRecord) =>
  r.suite
    ? `${r.suite.verdict} ${fmt(r.suite.mean)}${r.suite.ci ? ` [${fmt(r.suite.ci[0])}, ${fmt(r.suite.ci[1])}]` : ''}`
    : 'no verdict';

const line = (r: LedgerRecord) =>
  `- [${r.changeType}${r.skills.length ? `, ${r.skills.join('/')}` : ''}] ${cut(r.hypothesis, 100)} | ${verdictText(r)} | ${r.merged === null ? 'undecided' : r.merged ? 'merged' : 'discarded'}${r.lesson ? ` | lesson: ${cut(r.lesson, 140)}` : ''}`;

/**
 * Prompt section: the last RECENT records plus the best by suite delta, one line each, at most SUMMARY_CAP chars,
 * with the anti-repeat rule. `skills` limits it to records that touched one of them (empty = the whole plugin).
 * '' when there is nothing to show.
 */
export function ledgerSummary(all: LedgerRecord[], skills: string[] = []): string {
  const rs = skills.length ? all.filter((r) => r.skills.some((s) => skills.includes(s))) : all;
  if (!rs.length) return '';
  const best = rs.reduce<LedgerRecord | undefined>((b, r) => ((r.suite?.mean ?? -Infinity) > (b?.suite?.mean ?? -Infinity) ? r : b), undefined);
  const picked = rs.slice(-RECENT);
  const lines = (best && !picked.includes(best) ? [best, ...picked] : picked).map(line);
  const body = cut(lines.join('\n'), SUMMARY_CAP);
  return `Past changes${skills.length ? ` to ${skills.join(', ')}` : ''} (oldest first, best by delta may come first):\n${body}\nDo not propose a change equivalent to one recorded as regressed or inconclusive unless you have a new reason, and then say why it differs.`;
}
