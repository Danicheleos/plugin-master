import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExperimentSchema, LedgerRecordSchema, type Experiment, type ExperimentDiff, type RunExperiment } from '@pm/protocol';
import { z } from 'zod';
import { request } from '../../api/http';
import { useSpaceEvents } from '../../api/ws';

const expKey = (id: string) => ['experiments', id];
const url = (id: string, p = '') => `/api/spaces/${id}/experiments${p}`;

/** The list; `experiments.changed` and `git.changed` refetch every experiment query of the space. */
export function useExperiments(spaceId: string) {
  const qc = useQueryClient();
  useSpaceEvents(spaceId, (msg) => {
    if (msg.type === 'experiments.changed' || msg.type === 'git.changed')
      void qc.invalidateQueries({ queryKey: expKey(spaceId) });
  });
  return useQuery({
    queryKey: [...expKey(spaceId), 'list'],
    queryFn: () => request('GET', url(spaceId), undefined, z.array(ExperimentSchema)),
  });
}

export const useExperiment = (spaceId: string, n: number | null) =>
  useQuery({
    queryKey: [...expKey(spaceId), n],
    enabled: n !== null,
    queryFn: () => request('GET', url(spaceId, `/${n}`), undefined, ExperimentSchema),
  });

export const useExperimentDiff = (spaceId: string, n: number) =>
  useQuery({
    queryKey: [...expKey(spaceId), n, 'diff'],
    queryFn: () => request<ExperimentDiff>('GET', url(spaceId, `/${n}/diff`)),
  });

export function useRunExperiment(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RunExperiment) => request<Experiment>('POST', url(spaceId, '/run'), body),
    onSettled: () => qc.invalidateQueries({ queryKey: expKey(spaceId) }),
  });
}

export function useExperimentAction(spaceId: string, n: number, action: 'cancel' | 'merge' | 'discard') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<Experiment>('POST', url(spaceId, `/${n}/${action}`)),
    onSettled: () => qc.invalidateQueries({ queryKey: expKey(spaceId) }),
  });
}

export const useLedger = (spaceId: string) =>
  useQuery({
    queryKey: [...expKey(spaceId), 'ledger'],
    queryFn: () => request('GET', url(spaceId, '/ledger'), undefined, z.array(LedgerRecordSchema)),
  });
