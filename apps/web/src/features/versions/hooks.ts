import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { VersionsCompare, VersionsGate, VersionsResponse } from '@pm/protocol';
import { request } from '../../api/http';
import { useSpaceEvents } from '../../api/ws';
import { useOnChatIdle } from '../chat/ChatContext';

const key = (id: string) => ['versions', id];
const url = (id: string, p: string) => `/api/spaces/${id}/versions${p}`;

/** The commit list; git changes, a finished eval and a finished chat turn refetch every versions query. */
export function useVersions(spaceId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: key(spaceId) });
  useSpaceEvents(spaceId, (msg) => {
    if (msg.type === 'git.changed' || (msg.type === 'eval.status' && msg.state === 'done')) refresh();
  });
  useOnChatIdle(refresh);
  return useQuery({
    queryKey: [...key(spaceId), 'list'],
    queryFn: () => request<VersionsResponse>('GET', url(spaceId, '?limit=30')),
  });
}

const refs = (from: string, to: string) => `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

export const useVersionsCompare = (spaceId: string, from: string, to: string) =>
  useQuery({
    queryKey: [...key(spaceId), 'compare', from, to],
    queryFn: () => request<VersionsCompare>('GET', url(spaceId, `/compare${refs(from, to)}`)),
  });

export const useVersionsGate = (spaceId: string, from: string, to: string, enabled: boolean) =>
  useQuery({
    queryKey: [...key(spaceId), 'gate', from, to],
    enabled,
    queryFn: () => request<VersionsGate>('GET', url(spaceId, `/gate${refs(from, to)}`)),
  });
