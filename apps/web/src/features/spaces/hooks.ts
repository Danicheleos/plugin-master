import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SpaceSchema, type CreateSpace, type OpenSpace } from '@pm/protocol';
import { z } from 'zod';
import { request } from '../../api/http';

const KEY = ['spaces'];

export const useSpaces = () =>
  useQuery({
    queryKey: KEY,
    queryFn: () =>
      request('GET', '/api/spaces', undefined, z.array(SpaceSchema)),
  });

function useSpaceMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
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
  useSpaceMutation((id: string) =>
    request<void>('DELETE', `/api/spaces/${id}`),
  );
