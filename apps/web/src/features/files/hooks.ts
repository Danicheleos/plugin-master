import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileContentSchema,
  FileNodeSchema,
  type FileContent,
} from '@pm/protocol';
import { z } from 'zod';
import { request } from '../../api/http';

export const treeKey = (spaceId: string) => ['tree', spaceId];
export const fileKey = (spaceId: string, path: string) => [
  'file',
  spaceId,
  path,
];

export const useTree = (spaceId: string) =>
  useQuery({
    queryKey: treeKey(spaceId),
    queryFn: () =>
      request(
        'GET',
        `/api/spaces/${spaceId}/tree`,
        undefined,
        z.array(FileNodeSchema),
      ),
  });

export const useFile = (spaceId: string, path: string) =>
  useQuery({
    queryKey: fileKey(spaceId, path),
    queryFn: () =>
      request(
        'GET',
        `/api/spaces/${spaceId}/file?path=${encodeURIComponent(path)}`,
        undefined,
        FileContentSchema,
      ),
  });

export function useCreateFile(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: FileContent) =>
      request<void>('POST', `/api/spaces/${spaceId}/file`, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: treeKey(spaceId) }),
  });
}

export const useSaveFile = (spaceId: string) =>
  useMutation({
    mutationFn: (v: FileContent) =>
      request<void>('PUT', `/api/spaces/${spaceId}/file`, v),
  });
