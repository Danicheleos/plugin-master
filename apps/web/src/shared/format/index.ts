export const stamp = (iso?: string) => iso?.slice(0, 16).replace('T', ' ');
export const score = (n?: number) => (n === undefined ? '-' : n.toFixed(2));
/** One decimal. */
export const num = (n?: number) =>
  n === undefined ? '-' : String(Math.round(n * 10) / 10);
/** A change with an explicit "+" for positive values (`fmt` formats the number, default 2 decimals). */
export const signed = (
  n?: number,
  fmt: (n?: number) => string = (v) => (v === undefined ? '-' : v.toFixed(2)),
) => (n === undefined ? '-' : `${n > 0 ? '+' : ''}${fmt(n)}`);
export const delta = (n?: number) => signed(n);
/** "+0.12 [-0.05, +0.30]": a delta with its 95% interval (the interval is absent with too little data). */
export const deltaCi = (n?: number, ci?: [number, number]) =>
  ci ? `${delta(n)} [${delta(ci[0])}, ${delta(ci[1])}]` : delta(n);
export const cost = (n?: number, digits = 2) =>
  n === undefined ? '-' : `$${n.toFixed(digits)}`;
export const duration = (s?: number) =>
  s === undefined
    ? '-'
    : s >= 60
      ? `${Math.round(s / 60)}m`
      : `${Math.round(s)}s`;
/** Mantine color of a score against the pass threshold (default 1). */
export const scoreColor = (n: number | undefined, threshold = 1) =>
  n === undefined
    ? 'dimmed'
    : n >= threshold
      ? 'green'
      : n > 0
        ? 'yellow'
        : 'red';
export const tokens = (n?: number) =>
  n === undefined
    ? '-'
    : n >= 1000
      ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
      : String(Math.round(n));
export const seconds = (ms?: number) =>
  ms === undefined ? '-' : duration(ms / 1000);
/** Stopwatch text of a span in ms: "m:ss", or "h:mm:ss" from one hour. */
export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${m}:${String(s % 60).padStart(2, '0')}`;
};
export const bytes = (n?: number) =>
  n === undefined ? '-' : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
/** Milliseconds between two ISO timestamps; undefined while `end` is missing. */
export const elapsedMs = (start: string, end?: string) =>
  end ? Date.parse(end) - Date.parse(start) : undefined;
/** The short form of a git commit hash. */
export function shortHash(hash: string): string;
export function shortHash(hash?: string): string | undefined;
export function shortHash(hash?: string) {
  return hash?.slice(0, 7);
}
/** "just now", "5m ago", "3h ago", "2d ago" ('' for an unparsable timestamp). */
export function ago(iso: string, now = Date.now()) {
  const s = (now - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
