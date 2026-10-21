import { describe, expect, it } from 'vitest';
import type { PmMeta, VersionSide } from '@pm/protocol';
import { compareCases, evaluateGate, resolveCommit, type LogEntry } from './logic';

const log: LogEntry[] = [
  { hash: 'c3', tree: 't3', time: 3000 },
  { hash: 'c2', tree: 't2', time: 2000 },
  { hash: 'c1', tree: 't1', time: 1000 },
];
const meta = (o: Partial<PmMeta>): PmMeta => ({ commit: 'c2', tree: 't2', dirty: false, spaceId: 's', startedAt: '', ...o });
const iso = (ms: number) => new Date(ms).toISOString();

describe('resolveCommit', () => {
  it('uses the sidecar commit, not approximate', () => {
    expect(resolveCommit(meta({ dirty: true }), iso(9000), log)).toEqual({ hash: 'c2', approx: false, dirty: true });
  });
  it('falls back to the tree when the commit is gone', () => {
    expect(resolveCommit(meta({ commit: 'gone', tree: 't1' }), undefined, log)?.hash).toBe('c1');
  });
  it('keeps the sidecar commit when nothing matches', () => {
    expect(resolveCommit(meta({ commit: 'old', tree: 'x' }), undefined, log)?.hash).toBe('old');
  });
  it('maps by time without a sidecar', () => {
    expect(resolveCommit(undefined, iso(2500), log)).toEqual({ hash: 'c2', approx: true, dirty: false });
    expect(resolveCommit(undefined, iso(500), log)).toBeUndefined();
    expect(resolveCommit(undefined, undefined, log)).toBeUndefined();
  });
});

describe('compareCases', () => {
  it('joins by name with deltas', () => {
    const rows = compareCases(
      [{ name: 'a', score: 0.5 }, { name: 'b', score: 1 }],
      [{ name: 'b', score: 0.75 }, { name: 'c' }],
    );
    expect(rows.map((r) => [r.name, r.delta])).toEqual([['a', undefined], ['b', -0.25], ['c', undefined]]);
    expect(rows[0]).not.toHaveProperty('to');
    expect(rows[1].from).toEqual({ score: 1 });
  });
});

describe('evaluateGate', () => {
  const v: VersionSide = { hash: 'x' };
  const rule = (g: ReturnType<typeof evaluateGate>, id: string) => g.rules.find((r) => r.id === id)?.status;
  it('no data is unknown, never pass', () => {
    const g = evaluateGate(v, v, [], { fromBytes: 0, toBytes: 0 }, []);
    expect(g.status).toBe('unknown');
    expect(g.rules.map((r) => r.status)).toEqual(['unknown', 'unknown', 'unknown']);
  });
  it('passes when everything holds', () => {
    const cases = compareCases([{ name: 'a', score: 0.5 }], [{ name: 'a', score: 0.5, passed: true }]);
    expect(evaluateGate(v, v, cases, { fromBytes: 10, toBytes: 10 }, ['a']).status).toBe('pass');
  });
  const six = (to: number) => ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name, score: to }));
  it('fails on a significant regression, growth and a failed holdout', () => {
    const cases = compareCases(six(1), [{ name: 'a', score: 0.5, passed: false }, ...six(0.5).slice(1)]);
    const g = evaluateGate(v, v, cases, { fromBytes: 10, toBytes: 11 }, ['a']);
    expect(g.suite.verdict).toBe('regressed');
    expect(g.status).toBe('fail');
    expect(g.rules.map((r) => r.status)).toEqual(['fail', 'fail', 'fail']);
  });
  it('a lower case under an inconclusive suite does not block, it warns', () => {
    const cases = compareCases([{ name: 'a', score: 1 }], [{ name: 'a', score: 0.9, passed: true }]);
    const g = evaluateGate(v, v, cases, { fromBytes: 10, toBytes: 10 }, ['a']);
    expect(g.suite.verdict).toBe('inconclusive');
    expect(rule(g, 'no-regression')).toBe('pass');
    expect(g.status).toBe('pass');
    expect(g.warnings.join()).toMatch(/inconclusive/);
  });
  it('a single case that dropped beyond its own noise blocks, even in a small suite', () => {
    const side = (score: number, sd: number) => ({ score, sd, runs: 3 });
    const mk = (a: number, sa: number, b: number, sb: number) =>
      compareCases(
        [{ name: 'a', ...side(1, 0) }, { name: 'b', score: 0.5 }],
        [{ name: 'a', ...side(a, sa) }, { name: 'b', score: 0.5 }],
      ).map((c) => c);
    const g = evaluateGate(v, v, mk(0, 0, 0, 0), { fromBytes: 1, toBytes: 1 }, []);
    expect(g.suite.verdict).toBe('inconclusive');
    expect(rule(g, 'no-regression')).toBe('fail');
    expect(g.rules[0].cases).toEqual(['a']);
    // a small drop within noise only warns
    const h = evaluateGate(v, v, mk(0.9, 0.3, 0, 0), { fromBytes: 1, toBytes: 1 }, []);
    expect(rule(h, 'no-regression')).toBe('pass');
  });
  it('warns about flaky cases', () => {
    const cases = compareCases([{ name: 'a', score: 1 }], [{ name: 'a', score: 1, flaky: true }]);
    expect(evaluateGate(v, v, cases, { fromBytes: 1, toBytes: 1 }, []).warnings.join()).toMatch(/flaky/);
  });
  it('holdout without result is unknown; warns on dirty and approx', () => {
    const cases = compareCases([{ name: 'a', score: 1 }], [{ name: 'a', score: 1 }]);
    const g = evaluateGate({ hash: 'x', dirty: true }, { hash: 'y', approx: true }, cases, { fromBytes: 1, toBytes: 1 }, ['a']);
    expect(rule(g, 'holdout-pass')).toBe('unknown');
    expect(g.warnings).toHaveLength(3); // dirty, approx, plus a single case is inconclusive
  });
});
