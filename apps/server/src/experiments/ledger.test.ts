import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LedgerRecord } from '@pm/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendLedger, changeTypeOf, ledgerSummary, readLedger, recordOutcome } from './ledger';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pm-ledger-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const base = (o: Partial<LedgerRecord> = {}) => ({
  experiment: 1, kind: 'hypothesis' as const, skills: ['a'], files: ['skills/a/SKILL.md'], changeType: 'instructions' as const,
  hypothesis: 'h', diffSummary: 's', diffStat: { files: 1, additions: 2, deletions: 0 }, base: 'x', evalRunIds: [], cases: [], costUsd: 0, ...o,
});
const rec = (i: number, o: Partial<LedgerRecord> = {}): LedgerRecord => ({ ...base({ experiment: i, ...o }), id: `i${i}`, at: '2026-01-01T00:00:00Z', merged: null });

describe('ledger file', () => {
  it('appends records and folds outcomes into merged', async () => {
    await appendLedger(root, base({ experiment: 1 }));
    await appendLedger(root, base({ experiment: 2 }));
    await recordOutcome(root, 2, true);
    await recordOutcome(root, 99, true); // unknown experiment: ignored
    expect((await readLedger(root)).map((r) => [r.experiment, r.merged])).toEqual([[1, null], [2, true]]);
  });

  it('skips corrupt and foreign lines and a missing file', async () => {
    expect(await readLedger(root)).toEqual([]);
    await appendLedger(root, base());
    await appendFile(join(root, '.plugin-master/ledger.jsonl'), '{"half":\n[1]\n{"experiment":"x"}\n');
    await appendLedger(root, base({ experiment: 2 }));
    expect((await readLedger(root)).map((r) => r.experiment)).toEqual([1, 2]);
  });
});

describe('changeTypeOf', () => {
  it.each([
    ['description', ['skills/a/SKILL.md'], 'description'],
    ['hypothesis', ['skills/a/SKILL.md'], 'instructions'],
    ['hypothesis', ['skills/a/references/examples.md'], 'examples'],
    ['hypothesis', ['hooks/hooks.json'], 'hooks'],
    ['hypothesis', ['scripts/x.sh'], 'scripts'],
    ['hypothesis', ['skills/a/SKILL.md', 'scripts/x.sh'], 'structure'],
    ['hypothesis', ['a.png'], 'other'],
  ] as const)('%s %j -> %s', (kind, files, want) => expect(changeTypeOf(kind, [...files])).toBe(want));
});

describe('ledgerSummary', () => {
  it('is empty without records', () => expect(ledgerSummary([], ['a'])).toBe(''));

  it('keeps one skill, the last 8 and the best, with the anti-repeat rule', () => {
    const all = [
      rec(1, { hypothesis: 'BEST', suite: { cases: 5, mean: 0.9, verdict: 'improved' } }),
      ...Array.from({ length: 10 }, (_, i) => rec(i + 2, { hypothesis: `h${i + 2}`, lesson: 'l' })),
      rec(50, { skills: ['b'], hypothesis: 'OTHER-SKILL' }),
    ];
    const s = ledgerSummary(all, ['a']);
    expect(s).toContain('BEST | improved +0.90 | undecided');
    expect(s).toContain('h11');
    expect(s).not.toContain('h3 ');
    expect(s).not.toContain('OTHER-SKILL');
    expect(s.match(/^- /gm)).toHaveLength(9);
    expect(s).toContain('unless you have a new reason');
    expect(ledgerSummary(all)).toContain('OTHER-SKILL'); // no skill filter: whole plugin
  });

  it('caps the lines at 1500 chars', () => {
    const long = 'x'.repeat(500);
    const s = ledgerSummary(Array.from({ length: 12 }, (_, i) => rec(i + 1, { hypothesis: long, lesson: long })), ['a']);
    const body = s.slice(s.indexOf('\n') + 1, s.indexOf('\nDo not propose'));
    expect(body.length).toBeLessThanOrEqual(1501);
  });
});
