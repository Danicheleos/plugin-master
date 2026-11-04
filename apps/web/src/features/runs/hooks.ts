import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RunsResponseSchema, TraceSchema } from '@pm/protocol';
import { request } from '../../api/http';

export const runsKey = (spaceId: string) => ['runs', spaceId];

export const useRuns = (spaceId: string) =>
  useQuery({
    queryKey: runsKey(spaceId),
    queryFn: () =>
      request(
        'GET',
        `/api/spaces/${spaceId}/runs`,
        undefined,
        RunsResponseSchema,
      ),
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

export const LIVE_REFETCH_MS = 2500;

/**
 * Calls `refetch` when `tick` changes while `running`, at most once per `LIVE_REFETCH_MS` (a change
 * inside the window schedules one call at its end), plus once when `running` turns false.
 */
export function useLiveRefetch(
  refetch: () => void,
  { tick, running }: { tick: unknown; running: boolean },
) {
  const latest = useRef(refetch);
  latest.current = refetch;
  const last = useRef<number | null>(null); // null until mounted: the query's own first fetch counts
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasRunning = useRef(running);
  const fire = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    last.current = Date.now();
    latest.current();
  };
  useEffect(() => {
    if (last.current === null) {
      last.current = Date.now();
      return;
    }
    if (!running) return;
    const wait = last.current + LIVE_REFETCH_MS - Date.now();
    if (wait <= 0) fire();
    else timer.current ??= setTimeout(fire, wait);
  }, [tick, running]);
  useEffect(() => {
    if (wasRunning.current && !running) fire();
    wasRunning.current = running;
  }, [running]);
  useEffect(() => () => clearTimeout(timer.current), []);
}
