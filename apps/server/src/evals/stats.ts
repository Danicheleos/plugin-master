import { mean, sd, type SuiteDelta } from '@pm/protocol';

/** Two-sided 95% t quantiles for df 1..3 (the t-interval is used below BOOTSTRAP_MIN cases). */
const T95 = [12.706, 4.303, 3.182];
/** Cases needed for the bootstrap; below this the t-interval is used (it is wide, so usually inconclusive). */
export const BOOTSTRAP_MIN = 5;
const RESAMPLES = 2000;

/** Small deterministic PRNG (mulberry32), so the same data always gives the same interval. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Suite-level paired comparison: mean of the per-case deltas with a 95% interval. 5+ cases:
 * percentile bootstrap over cases (2000 resamples, fixed seed). 2-4 cases: paired t-interval.
 * Fewer than 2 cases: no interval, inconclusive. Verdict: improved if the interval is above 0,
 * regressed if below 0, otherwise inconclusive.
 */
export function suiteDelta(deltas: (number | undefined)[]): SuiteDelta {
  const d = deltas.filter((x): x is number => x !== undefined);
  const n = d.length;
  if (n < 2)
    return { cases: n, ...(n && { mean: d[0] }), verdict: 'inconclusive' };
  const m = mean(d)!;
  let ci: [number, number];
  if (n < BOOTSTRAP_MIN) {
    const h = T95[n - 2] * (sd(d)! / Math.sqrt(n));
    ci = [m - h, m + h];
  } else {
    const rand = rng(0x5eed);
    const means = Array.from({ length: RESAMPLES }, () => {
      let s = 0;
      for (let i = 0; i < n; i++) s += d[Math.floor(rand() * n)];
      return s / n;
    }).sort((a, b) => a - b);
    ci = [
      means[Math.floor(0.025 * RESAMPLES)],
      means[Math.ceil(0.975 * RESAMPLES) - 1],
    ];
  }
  const verdict =
    ci[0] > 0 ? 'improved' : ci[1] < 0 ? 'regressed' : 'inconclusive';
  return { cases: n, mean: m, ci, verdict };
}

/** Two-sided 95% t quantiles for df 1..10, 15, 20, 30 (floor of the df, so slightly conservative; above 30 uses 2.042). */
const T_DF: [number, number][] = [
  [1, 12.706],
  [2, 4.303],
  [3, 3.182],
  [4, 2.776],
  [5, 2.571],
  [6, 2.447],
  [7, 2.365],
  [8, 2.306],
  [9, 2.262],
  [10, 2.228],
  [15, 2.131],
  [20, 2.086],
  [30, 2.042],
];
const tCrit = (df: number) =>
  (T_DF.filter(([d]) => d <= df).pop() ?? T_DF[0])[1];

export type SideStat = { n?: number; mean?: number; sd?: number };

/**
 * One case dropped beyond noise: both sides have 2+ runs and the Welch 95% interval of the delta
 * (head - base) lies entirely below 0. Equal spread-free sides (e.g. all-pass vs all-fail) qualify.
 */
export function caseRegressed(base: SideStat, head: SideStat): boolean {
  if (
    base.mean === undefined ||
    head.mean === undefined ||
    base.sd === undefined ||
    head.sd === undefined
  )
    return false;
  const [n1, n2] = [base.n ?? 0, head.n ?? 0];
  if (n1 < 2 || n2 < 2) return false;
  const [v1, v2] = [base.sd ** 2 / n1, head.sd ** 2 / n2];
  const se = Math.sqrt(v1 + v2);
  const delta = head.mean - base.mean;
  if (se === 0) return delta < 0;
  const df = (v1 + v2) ** 2 / (v1 ** 2 / (n1 - 1) + v2 ** 2 / (n2 - 1));
  return delta + tCrit(Math.floor(df)) * se < 0;
}
