import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  HooksResponseSchema,
  type HooksResponse,
  type PutHooks,
} from '@pm/protocol';
import { request } from '../../api/http';
import { spaceUrl, useSpaceInvalidate } from '../../api/space';

export const hooksKey = (spaceId: string) => ['hooks', spaceId];

export const hooksQueries = {
  list: (spaceId: string) =>
    queryOptions({
      queryKey: hooksKey(spaceId),
      queryFn: () =>
        request(
          'GET',
          spaceUrl(spaceId, 'hooks'),
          undefined,
          HooksResponseSchema,
        ),
    }),
};

/** Hook listing. NOTE: also subscribes to `fs.changed` of its source files (refetch). */
export function useHooks(spaceId: string) {
  const q = useQuery(hooksQueries.list(spaceId));
  useSpaceInvalidate(
    spaceId,
    (m) =>
      m.type === 'fs.changed' &&
      !!q.data?.sources.some((s) => s.file === m.path),
    [hooksKey(spaceId)],
  );
  return q;
}

/** PUT one event of one file; the answer is the fresh listing, written to the cache as is. */
export function useSaveHooks(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PutHooks) =>
      request('PUT', spaceUrl(spaceId, 'hooks'), body, HooksResponseSchema),
    onSuccess: (data: HooksResponse) =>
      qc.setQueryData(hooksKey(spaceId), data),
  });
}
