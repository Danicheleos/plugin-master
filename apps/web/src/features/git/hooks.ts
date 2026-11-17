import { useEffect, useRef } from 'react';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  GitBranchesSchema,
  GitCommitSchema,
  GitDiffSchema,
  GitStatusSchema,
} from '@pm/protocol';
import { z } from 'zod';
import { IGNORED, request } from '../../api/http';
import { query, spaceUrl, useSpaceInvalidate } from '../../api/space';
import { useSpaceEvents } from '../../api/ws';
import { useOnChatIdle } from '../chat';

const FS_DEBOUNCE_MS = 300;
export const gitKey = (id: string) => ['git', id];
const gitUrl = (id: string, ...parts: string[]) =>
  spaceUrl(id, 'git', ...parts);

export const gitQueries = {
  status: (spaceId: string) =>
    queryOptions({
      queryKey: [...gitKey(spaceId), 'status'],
      queryFn: () =>
        request('GET', gitUrl(spaceId, 'status'), undefined, GitStatusSchema),
    }),
  diff: (spaceId: string, path: string | null) =>
    queryOptions({
      queryKey: [...gitKey(spaceId), 'diff', path],
      enabled: path !== null,
      queryFn: () =>
        request(
          'GET',
          gitUrl(spaceId, 'diff') + query({ path: path ?? '' }),
          undefined,
          GitDiffSchema,
        ),
    }),
  log: (spaceId: string) =>
    queryOptions({
      queryKey: [...gitKey(spaceId), 'log'],
      queryFn: () =>
        request(
          'GET',
          gitUrl(spaceId, 'log') + query({ limit: 30 }),
          undefined,
          z.array(GitCommitSchema),
        ),
    }),
  branches: (spaceId: string) =>
    queryOptions({
      queryKey: [...gitKey(spaceId), 'branches'],
      queryFn: () =>
        request(
          'GET',
          gitUrl(spaceId, 'branches'),
          undefined,
          GitBranchesSchema,
        ),
    }),
};

/**
 * Keeps every git query of the space fresh: `git.changed` and a finished chat turn refetch all of
 * them; `fs.changed` (bursty during a turn) only the status and the open diff, debounced.
 * Mount it once per widget that shows git data (`useGitStatus` does).
 */
export function useGitRefresh(spaceId: string) {
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useSpaceInvalidate(spaceId, (m) => m.type === 'git.changed', [
    gitKey(spaceId),
  ]);
  useSpaceEvents(spaceId, (msg) => {
    if (msg.type !== 'fs.changed') return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      for (const key of ['status', 'diff'])
        void qc.invalidateQueries({ queryKey: [...gitKey(spaceId), key] });
    }, FS_DEBOUNCE_MS);
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  useOnChatIdle(() => void qc.invalidateQueries({ queryKey: gitKey(spaceId) }));
}

/** The status query. NOTE: also mounts `useGitRefresh` (the WS/chat-idle subscriptions of all git queries). */
export function useGitStatus(spaceId: string) {
  useGitRefresh(spaceId);
  return useQuery(gitQueries.status(spaceId));
}

export const useGitDiff = (spaceId: string, path: string | null) =>
  useQuery(gitQueries.diff(spaceId, path));

export const useGitLog = (spaceId: string) => useQuery(gitQueries.log(spaceId));

export const useGitBranches = (spaceId: string) =>
  useQuery(gitQueries.branches(spaceId));

/** POST mutation of the git API; everything git is refetched afterwards (the answer is not used). */
export function useGitAction<V = undefined>(spaceId: string, path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: V) =>
      request('POST', gitUrl(spaceId, path), body, IGNORED),
    onSettled: () => qc.invalidateQueries({ queryKey: gitKey(spaceId) }),
  });
}
