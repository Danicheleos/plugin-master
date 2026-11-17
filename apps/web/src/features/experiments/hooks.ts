import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  ExperimentDiffSchema,
  ExperimentSchema,
  LedgerRecordSchema,
  type RunExperiment,
} from '@pm/protocol';
import { z } from 'zod';
import { request } from '../../api/http';
import { spaceUrl, useSpaceInvalidate } from '../../api/space';

export const experimentsKey = (id: string) => ['experiments', id];
const expUrl = (id: string, ...parts: (string | number)[]) =>
  spaceUrl(id, 'experiments', ...parts);

export const experimentQueries = {
  list: (spaceId: string) =>
    queryOptions({
      queryKey: [...experimentsKey(spaceId), 'list'],
      queryFn: () =>
        request('GET', expUrl(spaceId), undefined, z.array(ExperimentSchema)),
    }),
  one: (spaceId: string, n: number | null) =>
    queryOptions({
      queryKey: [...experimentsKey(spaceId), n],
      enabled: n !== null,
      queryFn: () =>
        request('GET', expUrl(spaceId, n ?? ''), undefined, ExperimentSchema),
    }),
  diff: (spaceId: string, n: number) =>
    queryOptions({
      queryKey: [...experimentsKey(spaceId), n, 'diff'],
      queryFn: () =>
        request(
          'GET',
          expUrl(spaceId, n, 'diff'),
          undefined,
          ExperimentDiffSchema,
        ),
    }),
  ledger: (spaceId: string) =>
    queryOptions({
      queryKey: [...experimentsKey(spaceId), 'ledger'],
      queryFn: () =>
        request(
          'GET',
          expUrl(spaceId, 'ledger'),
          undefined,
          z.array(LedgerRecordSchema),
        ),
    }),
};

/** `experiments.changed` and `git.changed` refetch every experiment query of the space. Mount once per widget. */
export function useExperimentsRefresh(spaceId: string) {
  useSpaceInvalidate(
    spaceId,
    (m) => m.type === 'experiments.changed' || m.type === 'git.changed',
    [experimentsKey(spaceId)],
  );
}

/** The list. NOTE: also mounts `useExperimentsRefresh` (the subscription for all experiment queries). */
export function useExperiments(spaceId: string) {
  useExperimentsRefresh(spaceId);
  return useQuery(experimentQueries.list(spaceId));
}

export const useExperiment = (spaceId: string, n: number | null) =>
  useQuery(experimentQueries.one(spaceId, n));

export const useExperimentDiff = (spaceId: string, n: number) =>
  useQuery(experimentQueries.diff(spaceId, n));

export function useRunExperiment(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RunExperiment) =>
      request('POST', expUrl(spaceId, 'run'), body, ExperimentSchema),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: experimentsKey(spaceId) }),
  });
}

export function useExperimentAction(
  spaceId: string,
  n: number,
  action: 'cancel' | 'merge' | 'discard',
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request('POST', expUrl(spaceId, n, action), undefined, ExperimentSchema),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: experimentsKey(spaceId) }),
  });
}

export const useLedger = (spaceId: string) =>
  useQuery(experimentQueries.ledger(spaceId));
