import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SpaceConfigSchema,
  type SpaceConfig,
  type SpaceConfigInput,
} from '@pm/protocol';
import { request } from '../../api/http';

export const configKey = (spaceId: string) => ['config', spaceId];

export const useSpaceConfig = (spaceId: string) =>
  useQuery({
    queryKey: configKey(spaceId),
    queryFn: () =>
      request(
        'GET',
        `/api/spaces/${spaceId}/config`,
        undefined,
        SpaceConfigSchema,
      ),
  });

/** Toggles a path in masterContext. Optimistic and based on the latest cache, so quick clicks do not lose updates. */
export function useToggleContext(spaceId: string) {
  const qc = useQueryClient();
  const put = useMutation({
    mutationFn: (v: SpaceConfigInput) =>
      request('PUT', `/api/spaces/${spaceId}/config`, v, SpaceConfigSchema),
    onMutate: (v) =>
      qc.setQueryData<SpaceConfig>(
        configKey(spaceId),
        (c) => c && { ...c, ...v },
      ),
    onError: () => qc.invalidateQueries({ queryKey: configKey(spaceId) }),
  });
  return (path: string) => {
    const cur =
      qc.getQueryData<SpaceConfig>(configKey(spaceId))?.masterContext ?? [];
    put.mutate({
      masterContext: cur.includes(path)
        ? cur.filter((p) => p !== path)
        : [...cur, path],
    });
  };
}
