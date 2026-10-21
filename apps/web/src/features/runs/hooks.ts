import { useQuery } from '@tanstack/react-query';
import { RunsResponseSchema, TraceSchema } from '@pm/protocol';
import { request } from '../../api/http';

export const runsKey = (spaceId: string) => ['runs', spaceId];

export const useRuns = (spaceId: string) =>
  useQuery({
    queryKey: runsKey(spaceId),
    queryFn: () =>
      request('GET', `/api/spaces/${spaceId}/runs`, undefined, RunsResponseSchema),
  });

/** Parsed trace of one recorded chat run. */
export const useRunTrace = (spaceId: string, runId: string) =>
  useQuery({
    queryKey: [...runsKey(spaceId), runId, 'trace'],
    queryFn: () =>
      request(
        'GET',
        `/api/spaces/${spaceId}/runs/${encodeURIComponent(runId)}/trace`,
        undefined,
        TraceSchema,
      ),
  });
