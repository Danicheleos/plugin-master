export const stamp = (iso?: string) => iso?.slice(0, 16).replace('T', ' ');
export const score = (n?: number) => (n === undefined ? '-' : n.toFixed(2));
/** One decimal. */
export const num = (n?: number) => (n === undefined ? '-' : String(Math.round(n * 10) / 10));
export const delta = (n?: number) =>
  n === undefined ? '-' : `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
/** "+0.12 [-0.05, +0.30]": a delta with its 95% interval (the interval is absent with too little data). */
export const deltaCi = (n?: number, ci?: [number, number]) =>
  ci ? `${delta(n)} [${delta(ci[0])}, ${delta(ci[1])}]` : delta(n);
export const cost = (n?: number) => (n === undefined ? '-' : `$${n.toFixed(2)}`);
export const duration = (s?: number) =>
  s === undefined ? '-' : s >= 60 ? `${Math.round(s / 60)}m` : `${Math.round(s)}s`;
/** Mantine color of a score against the pass threshold (default 1). */
export const scoreColor = (n: number | undefined, threshold = 1) =>
  n === undefined ? 'dimmed' : n >= threshold ? 'green' : n > 0 ? 'yellow' : 'red';
export const tokens = (n?: number) =>
  n === undefined ? '-' : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n));
export const seconds = (ms?: number) => (ms === undefined ? '-' : duration(ms / 1000));
