import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileContentSchema,
  FileNodeSchema,
  type FileContent,
} from '@pm/protocol';
import { z } from 'zod';
import { request } from '../../api/http';

/** Prefix of every loaded directory listing of the space. */
export const treeKey = (spaceId: string) => ['tree', spaceId];
export const fileKey = (spaceId: string, path: string) => [
  'file',
  spaceId,
  path,
];

/** One directory level (`dir` = '' for the root); loaded only while the directory is shown. */
export const useDir = (spaceId: string, dir: string) =>
  useQuery({
    queryKey: [...treeKey(spaceId), dir],
    queryFn: () =>
      request(
        'GET',
        `/api/spaces/${spaceId}/tree?dir=${encodeURIComponent(dir)}`,
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
