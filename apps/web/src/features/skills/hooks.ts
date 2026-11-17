import { queryOptions, useQuery } from '@tanstack/react-query';
import { listDir, listDirIfExists, treeKey, walkFiles } from '../files';
import { skillDir } from './paths';

// both keys sit under the tree prefix, so tree changes (fs.changed, file creation) refresh them
export const skillQueries = {
  /** Names of `skills/*` directories that contain a SKILL.md. */
  names: (spaceId: string) =>
    queryOptions({
      queryKey: [...treeKey(spaceId), 'skills'],
      queryFn: async () => {
        // a plugin without a `skills/` dir has no skills; any other failure is an error
        const nodes = await listDirIfExists(spaceId, 'skills');
        const dirs = nodes.filter((n) => n.type === 'dir');
        const has = await Promise.all(
          dirs.map(async (d) =>
            (await listDir(spaceId, d.path)).some((f) => f.name === 'SKILL.md'),
          ),
        );
        return dirs.filter((_, i) => has[i]).map((d) => d.name);
      },
    }),
  /** Files of one skill directory, relative to it (`references/a.md`); for link checks. */
  files: (spaceId: string, name: string) =>
    queryOptions({
      queryKey: [...treeKey(spaceId), 'skill-files', name],
      queryFn: async () => {
        const dir = skillDir(name);
        const paths = await walkFiles(spaceId, dir, 3);
        return new Set(paths.map((p) => p.slice(dir.length + 1)));
      },
    }),
};

export const useSkillNames = (spaceId: string) =>
  useQuery(skillQueries.names(spaceId));

export const useSkillFiles = (spaceId: string, name: string) =>
  useQuery(skillQueries.files(spaceId, name));
