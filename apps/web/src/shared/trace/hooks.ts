import { useEffect, useRef } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { TraceSchema } from '@pm/protocol';
import { request } from '../../api/http';
import { spaceUrl } from '../../api/space';
import { useLatestCallback } from '../ui/useLatestCallback';

export const runsKey = (spaceId: string) => ['runs', spaceId];

/** Parsed trace of one recorded chat run. */
export const runTraceQuery = (spaceId: string, runId: string) =>
  queryOptions({
    queryKey: [...runsKey(spaceId), runId, 'trace'],
    queryFn: () =>
      request(
        'GET',
        spaceUrl(spaceId, 'runs', runId, 'trace'),
        undefined,
        TraceSchema,
      ),
  });

export const useRunTrace = (spaceId: string, runId: string) =>
  useQuery(runTraceQuery(spaceId, runId));

export const LIVE_REFETCH_MS = 2500;

/**
 * Calls `refetch` when `tick` changes while `running`, at most once per `LIVE_REFETCH_MS` (a change
 * inside the window schedules one call at its end), plus once when `running` turns false.
 */
export function useLiveRefetch(
  refetch: () => void,
  { tick, running }: { tick: unknown; running: boolean },
) {
  const onRefetch = useLatestCallback(refetch);
  const last = useRef<number | null>(null); // null until mounted: the query's own first fetch counts
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasRunning = useRef(running);
  useEffect(() => {
    const fire = () => {
      clearTimeout(timer.current);
      timer.current = undefined;
      last.current = Date.now();
      onRefetch();
    };
    const stopped = wasRunning.current && !running;
    wasRunning.current = running;
    if (last.current === null) last.current = Date.now();
    else if (stopped) fire();
    else if (running) {
      const wait = last.current + LIVE_REFETCH_MS - Date.now();
      if (wait <= 0) fire();
      else timer.current ??= setTimeout(fire, wait);
    }
  }, [tick, running, onRefetch]);
  useEffect(() => () => clearTimeout(timer.current), []);
}

/** Live info of the chat session that writes a run: `tick` changes on new events, `running` while a turn runs. */
export type LiveRun = { tick: unknown; running: boolean };

const NOT_LIVE: LiveRun = { tick: 0, running: false };

/** The trace of a run, refetched while `live` says its session streams (same query key, so the UI state stays). */
export function useLiveRunTrace(
  spaceId: string,
  runId: string,
  live: LiveRun = NOT_LIVE,
) {
  const query = useRunTrace(spaceId, runId);
  const { refetch } = query;
  useLiveRefetch(() => void refetch(), live);
  return query;
}
