import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { FeaturesSchema, type Features } from '@pm/protocol';
import { request } from '../../api/http';
import { spaceUrl } from '../../api/space';
import { useSpaceEvents } from '../../api/ws';

export const featuresKey = (spaceId: string) => ['features', spaceId];

export const featureQueries = {
  features: (spaceId: string) =>
    queryOptions({
      queryKey: featuresKey(spaceId),
      queryFn: () =>
        request(
          'GET',
          spaceUrl(spaceId, 'features'),
          undefined,
          FeaturesSchema,
        ),
    }),
};

/** Optional features of the space. NOTE: also applies other tabs' changes (`features.changed` carries the new value). */
export function useFeatures(spaceId: string) {
  const qc = useQueryClient();
  useSpaceEvents(spaceId, (msg) => {
    if (msg.type === 'features.changed')
      qc.setQueryData(featuresKey(spaceId), msg.features);
  });
  return useQuery(featureQueries.features(spaceId));
}

/** The answer is the full fresh value, written to the cache as is. */
export function useSetFeatures(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Partial<Features>) =>
      request('PUT', spaceUrl(spaceId, 'features'), v, FeaturesSchema),
    onSuccess: (f) => qc.setQueryData(featuresKey(spaceId), f),
  });
}
