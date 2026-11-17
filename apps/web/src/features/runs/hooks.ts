import { queryOptions, useQuery } from '@tanstack/react-query';
import { RunsResponseSchema } from '@pm/protocol';
import { request } from '../../api/http';
import { spaceUrl } from '../../api/space';
import { runsKey } from '../../shared/trace/hooks';

export { runsKey };

export const runQueries = {
  list: (spaceId: string) =>
    queryOptions({
      queryKey: runsKey(spaceId),
      queryFn: () =>
        request(
          'GET',
          spaceUrl(spaceId, 'runs'),
          undefined,
          RunsResponseSchema,
        ),
    }),
};

export const useRuns = (spaceId: string) => useQuery(runQueries.list(spaceId));
