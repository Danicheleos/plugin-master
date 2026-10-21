import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GitBranches, GitCommit, GitDiff, GitStatus } from '@pm/protocol';
import { request } from '../../api/http';
import { useSpaceEvents } from '../../api/ws';
import { useOnChatIdle } from '../chat/ChatContext';

const FS_DEBOUNCE_MS = 300;
const gitKey = (id: string) => ['git', id];
const url = (id: string, p: string) => `/api/spaces/${id}/git/${p}`;

/**
 * `git.changed` and a finished chat turn refetch every git query; `fs.changed` (bursty during a
 * turn) only the status and the open diff, debounced.
 */
function useGitRefresh(spaceId: string) {
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const refresh = () => void qc.invalidateQueries({ queryKey: gitKey(spaceId) });
  useSpaceEvents(spaceId, (msg) => {
    if (msg.type === 'git.changed') refresh();
    else if (msg.type === 'fs.changed') {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        for (const key of ['status', 'diff'])
          void qc.invalidateQueries({ queryKey: [...gitKey(spaceId), key] });
      }, FS_DEBOUNCE_MS);
    }
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  useOnChatIdle(refresh);
}

export function useGitStatus(spaceId: string) {
  useGitRefresh(spaceId);
  return useQuery({
    queryKey: [...gitKey(spaceId), 'status'],
    queryFn: () => request<GitStatus>('GET', url(spaceId, 'status')),
  });
}

export const useGitDiff = (spaceId: string, path: string | null) =>
  useQuery({
    queryKey: [...gitKey(spaceId), 'diff', path],
    enabled: path !== null,
    queryFn: () =>
      request<GitDiff>('GET', url(spaceId, `diff?path=${encodeURIComponent(path ?? '')}`)),
  });

export const useGitLog = (spaceId: string) =>
  useQuery({
    queryKey: [...gitKey(spaceId), 'log'],
    queryFn: () => request<GitCommit[]>('GET', url(spaceId, 'log?limit=30')),
  });

export const useGitBranches = (spaceId: string) =>
  useQuery({
    queryKey: [...gitKey(spaceId), 'branches'],
    queryFn: () => request<GitBranches>('GET', url(spaceId, 'branches')),
  });

/** POST mutation of the git API; everything git is refetched afterwards. */
export function useGitAction<V = undefined>(spaceId: string, path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: V) => request<unknown>('POST', url(spaceId, path), body),
    onSettled: () => qc.invalidateQueries({ queryKey: gitKey(spaceId) }),
  });
}
