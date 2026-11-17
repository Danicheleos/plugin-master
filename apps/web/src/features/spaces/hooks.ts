import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { SpaceSchema, type CreateSpace, type OpenSpace } from '@pm/protocol';
import { z } from 'zod';
import { request } from '../../api/http';
import { spaceUrl } from '../../api/space';

export const spacesKey = ['spaces'];

export const spaceQueries = {
  list: () =>
    queryOptions({
      queryKey: spacesKey,
      queryFn: () =>
        request('GET', '/api/spaces', undefined, z.array(SpaceSchema)),
      // the list has no WS push: always refetch when the page is shown again
      staleTime: 0,
    }),
};

export const useSpaces = () => useQuery(spaceQueries.list());

/** One space of the list (undefined until loaded); re-renders only when that space changes. */
export const useSpace = (id: string) =>
  useQuery({
    ...spaceQueries.list(),
    select: (list) => list.find((s) => s.id === id),
  }).data;

function useSpaceMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: spacesKey }),
  });
}

export const useCreateSpace = () =>
  useSpaceMutation((v: CreateSpace) =>
    request('POST', '/api/spaces', v, SpaceSchema),
  );

export const useOpenSpace = () =>
  useSpaceMutation((v: OpenSpace) =>
    request('POST', '/api/spaces/open', v, SpaceSchema),
  );

export const useRemoveSpace = () =>
  useSpaceMutation((id: string) => request<void>('DELETE', spaceUrl(id)));
