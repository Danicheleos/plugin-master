import { describe, expect, it } from 'vitest';
import { caseRegressed, caseStats, pairedDelta, sd, suiteDelta } from './stats';

describe('caseStats', () => {
  it('gives n, mean and sd', () => {
    const s = caseStats([{ score: 1 }, { score: 0.5 }, { score: 0 }]);
    expect(s).toMatchObject({ n: 3, mean: 0.5, sd: 0.5, flaky: true });
  });
  it('one run has no sd and is not flaky; passed stands in for a missing score', () => {
    expect(caseStats([{ score: 0.8 }])).toEqual({ n: 1, mean: 0.8, flaky: false });
    expect(caseStats([{ passed: true }, { passed: true }])).toMatchObject({ n: 2, mean: 1, sd: 0, flaky: false });
  });
  it('flaky when runs both pass and fail, even with close scores', () => {
    expect(caseStats([{ score: 0.5, passed: true }, { score: 0.45, passed: false }]).flaky).toBe(true);
  });
  it('no runs', () => {
    expect(caseStats([])).toEqual({ n: 0, flaky: false });
  });
  it('sd needs two values', () => {
    expect(sd([1])).toBeUndefined();
  });
});

describe('pairedDelta', () => {
  it('needs both sides', () => {
    expect(pairedDelta(0.25, 0.75)).toBe(0.5);
    expect(pairedDelta(undefined, 1)).toBeUndefined();
  });
});

describe('suiteDelta', () => {
  it('fewer than 2 cases is inconclusive without an interval', () => {
    expect(suiteDelta([])).toEqual({ cases: 0, verdict: 'inconclusive' });
    expect(suiteDelta([0.5, undefined])).toEqual({ cases: 1, mean: 0.5, verdict: 'inconclusive' });
  });
  it('t-interval for 2-4 cases', () => {
    const s = suiteDelta([0.2, 0.3, 0.25]);
    expect(s.mean).toBeCloseTo(0.25);
    // t(2) = 4.303, se = 0.05 / sqrt(3)
    expect(s.ci![0]).toBeCloseTo(0.25 - (4.303 * 0.05) / Math.sqrt(3), 6);
    expect(s.verdict).toBe('improved');
  });
  it('a wide t-interval crossing 0 is inconclusive', () => {
    expect(suiteDelta([0.5, -0.3]).verdict).toBe('inconclusive');
  });
  it('bootstrap for 5+ cases is deterministic', () => {
    const d = [0.2, 0.1, 0.3, 0.2, 0.4, 0.1];
    expect(suiteDelta(d)).toEqual(suiteDelta([...d]));
    const s = suiteDelta(d);
    expect(s.mean).toBeCloseTo(0.2166667, 5);
    expect(s.ci![0]).toBeGreaterThan(0.1);
    expect(s.ci![1]).toBeLessThan(0.4);
    expect(s.verdict).toBe('improved');
  });
  it('regressed when the interval is below 0', () => {
    expect(suiteDelta([-0.2, -0.1, -0.3, -0.2, -0.4]).verdict).toBe('regressed');
  });
  it('inconclusive when the interval crosses 0, or all deltas are 0', () => {
    expect(suiteDelta([0.5, -0.5, 0.4, -0.4, 0.1, -0.1]).verdict).toBe('inconclusive');
    expect(suiteDelta([0, 0, 0, 0, 0]).verdict).toBe('inconclusive');
  });
});

describe('caseRegressed', () => {
  it('needs 2+ runs on both sides', () => {
    expect(caseRegressed({ n: 1, mean: 1 }, { n: 3, mean: 0, sd: 0 })).toBe(false);
  });
  it('all-pass to all-fail is a regression; a noisy small drop is not', () => {
    expect(caseRegressed({ n: 2, mean: 1, sd: 0 }, { n: 2, mean: 0, sd: 0 })).toBe(true);
    expect(caseRegressed({ n: 3, mean: 0.9, sd: 0.3 }, { n: 3, mean: 0.7, sd: 0.3 })).toBe(false);
    expect(caseRegressed({ n: 3, mean: 1, sd: 0.05 }, { n: 3, mean: 0.5, sd: 0.1 })).toBe(true);
  });
});
