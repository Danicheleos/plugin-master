import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  FileContentSchema,
  FileNodeSchema,
  type FileContent,
} from '@pm/protocol';
import { z } from 'zod';
import { isNotFound, request } from '../../api/http';
import { query, spaceUrl } from '../../api/space';

/** Prefix of every loaded directory listing of the space (and of skill listings built on it). */
export const treeKey = (spaceId: string) => ['tree', spaceId];
export const fileKey = (spaceId: string, path: string) => [
  'file',
  spaceId,
  path,
];

export const fileQueries = {
  /** One directory level (`dir` = '' for the root). */
  dir: (spaceId: string, dir: string) =>
    queryOptions({
      queryKey: [...treeKey(spaceId), dir],
      queryFn: () =>
        request(
          'GET',
          spaceUrl(spaceId, 'tree') + query({ dir }),
          undefined,
          z.array(FileNodeSchema),
        ),
    }),
  file: (spaceId: string, path: string) =>
    queryOptions({
      queryKey: fileKey(spaceId, path),
      queryFn: () =>
        request(
          'GET',
          spaceUrl(spaceId, 'file') + query({ path }),
          undefined,
          FileContentSchema,
        ),
    }),
};

/** One directory level (`dir` = '' for the root); loaded only while the directory is shown. */
export const useDir = (spaceId: string, dir: string) =>
  useQuery(fileQueries.dir(spaceId, dir));

export const useFile = (spaceId: string, path: string) =>
  useQuery(fileQueries.file(spaceId, path));

export function useCreateFile(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: FileContent) =>
      request<void>('POST', spaceUrl(spaceId, 'file'), v),
    onSettled: () => qc.invalidateQueries({ queryKey: treeKey(spaceId) }),
  });
}

/** The caller (`FileEditor`) writes the saved content into the file cache, so nothing is invalidated here. */
export const useSaveFile = (spaceId: string) =>
  useMutation({
    mutationFn: (v: FileContent) =>
      request<void>('PUT', spaceUrl(spaceId, 'file'), v),
  });

export function useDeleteFile(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      request<void>('DELETE', spaceUrl(spaceId, 'file') + query({ path })),
    onSettled: (_void, _err, path) => {
      qc.removeQueries({ queryKey: fileKey(spaceId, path) });
      return qc.invalidateQueries({ queryKey: treeKey(spaceId) });
    },
  });
}

/** One directory level, fetched directly (not cached); a missing directory rejects with a not-found `ApiError`. */
export const listDir = (spaceId: string, dir: string) =>
  request(
    'GET',
    spaceUrl(spaceId, 'tree') + query({ dir }),
    undefined,
    z.array(FileNodeSchema),
  );

/** Like `listDir`, but a missing directory is an empty list. */
export const listDirIfExists = (spaceId: string, dir: string) =>
  listDir(spaceId, dir).catch((e: unknown) => {
    if (isNotFound(e)) return [];
    throw e;
  });

/** The text of a file, fetched directly; `undefined` when the file does not exist. */
export const readFileText = (spaceId: string, path: string) =>
  request(
    'GET',
    spaceUrl(spaceId, 'file') + query({ path }),
    undefined,
    FileContentSchema,
  ).then(
    (f): string | undefined => f.content,
    (e: unknown) => {
      if (isNotFound(e)) return undefined;
      throw e;
    },
  );

/**
 * Paths of the files below `dir` (relative to the space), descending `depth` levels of
 * subdirectories. With `ifMissing: 'empty'` a missing directory counts as empty.
 */
export async function walkFiles(
  spaceId: string,
  dir: string,
  depth: number,
  opts: { ifMissing?: 'empty' | 'throw' } = {},
): Promise<string[]> {
  const list = opts.ifMissing === 'empty' ? listDirIfExists : listDir;
  const nodes = await list(spaceId, dir);
  const nested = await Promise.all(
    nodes.map((n) =>
      n.type === 'file'
        ? [n.path]
        : depth > 0
          ? walkFiles(spaceId, n.path, depth - 1, opts)
          : [],
    ),
  );
  return nested.flat();
}

/**
 * Saves `text` to `path` for a draft (see `useDraft`): after the write the draft takes it as its
 * base and the file cache gets it, so the editor sees `disk === value` at once. `create` writes
 * with the create endpoint (for a file that was deleted on disk).
 */
export function useSaveDraft(
  spaceId: string,
  path: string,
  draft: { saved: (text: string) => void },
  { create = false }: { create?: boolean } = {},
) {
  const save = useSaveFile(spaceId);
  const createFile = useCreateFile(spaceId);
  const qc = useQueryClient();
  const writer = create ? createFile : save;
  const write = async (text: string) => {
    await writer.mutateAsync({ path, content: text });
    // state first, then cache: the cache update re-renders with disk === value
    draft.saved(text);
    qc.setQueryData(fileKey(spaceId, path), { path, content: text });
  };
  return { write, isPending: writer.isPending, error: writer.error };
}
