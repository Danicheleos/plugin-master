import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HooksResponseSchema, type HooksResponse, type PutHooks } from '@pm/protocol';
import { request } from '../../api/http';
import { useSpaceEvents } from '../../api/ws';

export const hooksKey = (spaceId: string) => ['hooks', spaceId];

/** Hook listing; refetched when a (watched) source file changes. */
export function useHooks(spaceId: string) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: hooksKey(spaceId),
    queryFn: () => request('GET', `/api/spaces/${spaceId}/hooks`, undefined, HooksResponseSchema),
  });
  useSpaceEvents(spaceId, (msg) => {
    if (msg.type === 'fs.changed' && q.data?.sources.some((s) => s.file === msg.path))
      void qc.invalidateQueries({ queryKey: hooksKey(spaceId) });
  });
  return q;
}

/** PUT one event of one file; the answer is the fresh listing. */
export function useSaveHooks(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PutHooks) => request('PUT', `/api/spaces/${spaceId}/hooks`, body, HooksResponseSchema),
    onSuccess: (data: HooksResponse) => qc.setQueryData(hooksKey(spaceId), data),
  });
}
