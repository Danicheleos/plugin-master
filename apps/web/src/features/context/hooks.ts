import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  SpaceConfigSchema,
  type SpaceConfig,
  type SpaceConfigInput,
} from '@pm/protocol';
import { request } from '../../api/http';
import { spaceUrl } from '../../api/space';

export const configKey = (spaceId: string) => ['config', spaceId];

export const configQueries = {
  config: (spaceId: string) =>
    queryOptions({
      queryKey: configKey(spaceId),
      queryFn: () =>
        request(
          'GET',
          spaceUrl(spaceId, 'config'),
          undefined,
          SpaceConfigSchema,
        ),
    }),
};

export const useSpaceConfig = (spaceId: string) =>
  useQuery(configQueries.config(spaceId));

/**
 * Toggles a path in masterContext. Optimistic and based on the latest cache, so quick clicks do not
 * lose updates. The server's answer is the truth: the config is refetched when the last in-flight
 * toggle settles (which also rolls a failed one back); `error` is the last failure.
 */
export function useToggleContext(spaceId: string) {
  const qc = useQueryClient();
  const mutationKey = ['config-toggle', spaceId];
  const put = useMutation({
    mutationKey,
    mutationFn: (v: SpaceConfigInput) =>
      request('PUT', spaceUrl(spaceId, 'config'), v, SpaceConfigSchema),
    onMutate: (v) =>
      qc.setQueryData<SpaceConfig>(
        configKey(spaceId),
        (c) => c && { ...c, ...v },
      ),
    onSettled: () =>
      qc.isMutating({ mutationKey }) === 1
        ? qc.invalidateQueries({ queryKey: configKey(spaceId) })
        : undefined,
  });
  const toggle = (path: string) => {
    const cur =
      qc.getQueryData<SpaceConfig>(configKey(spaceId))?.masterContext ?? [];
    put.mutate({
      masterContext: cur.includes(path)
        ? cur.filter((p) => p !== path)
        : [...cur, path],
    });
  };
  return { toggle, error: put.error };
}
