import { useQuery } from '@tanstack/react-query';
import { FileNodeSchema } from '@pm/protocol';
import { z } from 'zod';
import { request } from '../../api/http';
import { treeKey } from '../files/hooks';

const list = (spaceId: string, dir: string) =>
  request('GET', `/api/spaces/${spaceId}/tree?dir=${encodeURIComponent(dir)}`, undefined, z.array(FileNodeSchema));

/** Files below `dir` as paths relative to it (a few levels deep). */
async function walk(spaceId: string, dir: string, prefix: string, depth: number): Promise<string[]> {
  const nodes = await list(spaceId, dir);
  const nested = await Promise.all(
    nodes.map((n) =>
      n.type === 'file' ? [`${prefix}${n.name}`] : depth > 0 ? walk(spaceId, n.path, `${prefix}${n.name}/`, depth - 1) : [],
    ),
  );
  return nested.flat();
}

// both keys sit under the tree prefix, so tree changes (fs.changed, file creation) refresh them

/** Names of `skills/*` directories that contain a SKILL.md. */
export const useSkillNames = (spaceId: string) =>
  useQuery({
    queryKey: [...treeKey(spaceId), 'skills'],
    queryFn: async () => {
      const dirs = (await list(spaceId, 'skills').catch(() => [])).filter((n) => n.type === 'dir');
      const has = await Promise.all(dirs.map(async (d) => (await list(spaceId, d.path)).some((f) => f.name === 'SKILL.md')));
      return dirs.filter((_, i) => has[i]).map((d) => d.name);
    },
  });

/** Files of one skill directory, relative to it (`references/a.md`); for link checks. */
export const useSkillFiles = (spaceId: string, name: string) =>
  useQuery({
    queryKey: [...treeKey(spaceId), 'skill-files', name],
    queryFn: async () => new Set(await walk(spaceId, `skills/${name}`, '', 3)),
  });
