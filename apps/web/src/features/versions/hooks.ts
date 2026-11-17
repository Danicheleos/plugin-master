import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GitDiffSchema,
  VersionsCompareSchema,
  VersionsGateSchema,
  VersionsResponseSchema,
} from '@pm/protocol';
import { request } from '../../api/http';
import { query, spaceUrl, useSpaceInvalidate } from '../../api/space';
import { useOnChatIdle } from '../chat';

export const versionsKey = (id: string) => ['versions', id];
const versionsUrl = (id: string, ...parts: string[]) =>
  spaceUrl(id, 'versions', ...parts);

export const versionsQueries = {
  list: (spaceId: string) =>
    queryOptions({
      queryKey: [...versionsKey(spaceId), 'list'],
      queryFn: () =>
        request(
          'GET',
          versionsUrl(spaceId) + query({ limit: 30 }),
          undefined,
          VersionsResponseSchema,
        ),
    }),
  compare: (spaceId: string, from: string, to: string) =>
    queryOptions({
      queryKey: [...versionsKey(spaceId), 'compare', from, to],
      queryFn: () =>
        request(
          'GET',
          versionsUrl(spaceId, 'compare') + query({ from, to }),
          undefined,
          VersionsCompareSchema,
        ),
    }),
  /** One file between the two commits. */
  diff: (spaceId: string, from: string, to: string, path: string) =>
    queryOptions({
      queryKey: [...versionsKey(spaceId), 'diff', from, to, path],
      queryFn: () =>
        request(
          'GET',
          versionsUrl(spaceId, 'diff') + query({ from, to, path }),
          undefined,
          GitDiffSchema,
        ),
    }),
  gate: (spaceId: string, from: string, to: string) =>
    queryOptions({
      queryKey: [...versionsKey(spaceId), 'gate', from, to],
      queryFn: () =>
        request(
          'GET',
          versionsUrl(spaceId, 'gate') + query({ from, to }),
          undefined,
          VersionsGateSchema,
        ),
    }),
};

/**
 * Keeps every versions query of the space fresh: git changes, a finished eval and a finished chat
 * turn refetch them all. Mount once per widget that shows versions (`useVersions` does).
 */
export function useVersionsRefresh(spaceId: string) {
  const qc = useQueryClient();
  useSpaceInvalidate(
    spaceId,
    (m) =>
      m.type === 'git.changed' ||
      (m.type === 'eval.status' && m.state === 'done'),
    [versionsKey(spaceId)],
  );
  useOnChatIdle(
    () => void qc.invalidateQueries({ queryKey: versionsKey(spaceId) }),
  );
}

/** The commit list. NOTE: also mounts `useVersionsRefresh` (the subscriptions for all versions queries). */
export function useVersions(spaceId: string) {
  useVersionsRefresh(spaceId);
  return useQuery(versionsQueries.list(spaceId));
}

export const useVersionsCompare = (spaceId: string, from: string, to: string) =>
  useQuery(versionsQueries.compare(spaceId, from, to));

export const useVersionsDiff = (
  spaceId: string,
  from: string,
  to: string,
  path: string,
) => useQuery(versionsQueries.diff(spaceId, from, to, path));

export const useVersionsGate = (
  spaceId: string,
  from: string,
  to: string,
  enabled: boolean,
) => useQuery({ ...versionsQueries.gate(spaceId, from, to), enabled });
