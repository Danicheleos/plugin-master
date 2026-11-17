import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { ServerMessage } from '@pm/protocol';
import { useSpaceEvents } from './ws';

/**
 * `/api/spaces/<id>/<parts…>`: every segment is URI-encoded, so ids, names and run ids
 * cannot break out of their position. A part that is itself a nested id (`plugin-eval/x`)
 * is passed as several parts: `spaceUrl(id, 'evals', 'runs', ...runId.split('/'))`.
 */
export const spaceUrl = (
  spaceId: string,
  ...parts: (string | number)[]
): string =>
  ['/api/spaces', spaceId, ...parts]
    .map((p, i) => (i === 0 ? p : encodeURIComponent(p)))
    .join('/');

/** `?a=1&b=x` of the defined params (values encoded); '' when none. */
export function query(
  params: Record<string, string | number | undefined>,
): string {
  const q = Object.entries(params)
    .filter((e): e is [string, string | number] => e[1] !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return q && `?${q}`;
}

/** Splits a nested id (`a/b`) into URL parts for `spaceUrl`. */
export const idParts = (id: string): string[] => id.split('/');

/**
 * Invalidates every query under `keys` when a WS message of the space matches `match`.
 * `match` may read current render state: it always runs the latest closure.
 */
export function useSpaceInvalidate(
  spaceId: string,
  match: (msg: ServerMessage) => boolean,
  keys: readonly QueryKey[],
): void {
  const qc = useQueryClient();
  useSpaceEvents(spaceId, (msg) => {
    if (!match(msg)) return;
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
  });
}
