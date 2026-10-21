import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FeaturesSchema, type Features } from '@pm/protocol';
import { request } from '../../api/http';
import { useSpaceEvents } from '../../api/ws';

const featuresKey = (spaceId: string) => ['features', spaceId];
const url = (spaceId: string) => `/api/spaces/${spaceId}/features`;

/** Optional features of the space; other tabs' changes arrive as `features.changed`. */
export function useFeatures(spaceId: string) {
  const qc = useQueryClient();
  useSpaceEvents(spaceId, (msg) => {
    if (msg.type === 'features.changed')
      qc.setQueryData(featuresKey(spaceId), msg.features);
  });
  return useQuery({
    queryKey: featuresKey(spaceId),
    queryFn: () => request('GET', url(spaceId), undefined, FeaturesSchema),
  });
}

export function useSetFeatures(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Partial<Features>) =>
      request('PUT', url(spaceId), v, FeaturesSchema),
    onSuccess: (f) => qc.setQueryData(featuresKey(spaceId), f),
  });
}
