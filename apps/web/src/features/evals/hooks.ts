import { z } from 'zod';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EvalGroupResponseSchema,
  EvalRunResponseSchema,
  EvalRunsResponseSchema,
  TraceSchema,
  EvalSuiteSchema,
  EvalSuitesResponseSchema,
  EvalTargetsResponseSchema,
  type EvalGroup,
  type EvalLine,
  type EvalRunRequest,
  type EvalRunResponse,
  type EvalStatus,
} from '@pm/protocol';
import { useSpaceEvents } from '../../api/ws';
import { request, requestText } from '../../api/http';

export const evalsKey = (spaceId: string) => ['evals', spaceId];
const runKey = (spaceId: string, runId: string) => [
  ...evalsKey(spaceId),
  'run',
  runId,
];

// run ids can be nested (`plugin-eval/x`): encode each segment, keep the slashes
const idPath = (runId: string) =>
  runId.split('/').map(encodeURIComponent).join('/');

const EXTERNAL_POLL_MS = 5000;
export const evalRunsKey = (spaceId: string) => [...evalsKey(spaceId), 'runs'];
export const fetchEvalRuns = (spaceId: string) =>
  request('GET', `/api/spaces/${spaceId}/evals/runs`, undefined, EvalRunsResponseSchema);

/** `enabled` false: the workspace only needs the eval dir while the Evals tab is open. */
export const useEvalRuns = (spaceId: string, enabled = true) =>
  useQuery({
    enabled,
    queryKey: evalRunsKey(spaceId),
    queryFn: () => fetchEvalRuns(spaceId),
    // an external series has no WS event of its own: poll while one is live
    refetchInterval: (q) => (q.state.data?.external ? EXTERNAL_POLL_MS : false),
  });

export const useEvalSuites = (spaceId: string) =>
  useQuery({
    queryKey: [...evalsKey(spaceId), 'suites'],
    queryFn: () =>
      request('GET', `/api/spaces/${spaceId}/evals/suites`, undefined, EvalSuitesResponseSchema),
  });

export const useEvalTargets = (spaceId: string) =>
  useQuery({
    queryKey: [...evalsKey(spaceId), 'targets'],
    queryFn: () =>
      request('GET', `/api/spaces/${spaceId}/evals/targets`, undefined, EvalTargetsResponseSchema),
  });

export const useEvalSuite = (spaceId: string) =>
  useQuery({
    queryKey: [...evalsKey(spaceId), 'suite'],
    queryFn: () =>
      request('GET', `/api/spaces/${spaceId}/evals/suite`, undefined, EvalSuiteSchema),
  });

/** One run, or with `group` the merged view of the group whose first run is `runId`. */
export const useEvalRun = (spaceId: string, runId: string, group = false, enabled = true) =>
  useQuery({
    enabled,
    queryKey: group ? [...runKey(spaceId, runId), 'group'] : runKey(spaceId, runId),
    queryFn: (): Promise<EvalRunResponse & { group?: EvalGroup }> =>
      request(
        'GET',
        `/api/spaces/${spaceId}/evals/${group ? 'groups' : 'runs'}/${idPath(runId)}`,
        undefined,
        group ? EvalGroupResponseSchema : EvalRunResponseSchema,
      ),
  });

/** The report is fetched with the token and shown via `srcdoc`: a plain iframe `src` carries no auth header. */
export const useEvalReport = (spaceId: string, runId: string) =>
  useQuery({
    queryKey: [...runKey(spaceId, runId), 'report'],
    queryFn: () =>
      requestText(`/api/spaces/${spaceId}/evals/report/${idPath(runId)}`),
  });

const MAX_LINES = 500;
const idle: EvalStatus = { state: 'idle' };

/** Live state of the eval process of a space (WS `eval.*`); `onDone` gets the id of a finished run. */
export function useEvalLive(spaceId: string, onDone: (runId: string) => void) {
  const [status, setStatus] = useState<EvalStatus>(idle);
  const [lines, setLines] = useState<EvalLine[]>([]);
  const qc = useQueryClient();
  const done = useRef(onDone);
  done.current = onDone;
  useSpaceEvents(spaceId, (msg) => {
    if (msg.type === 'eval.history') {
      setLines(msg.lines);
      setStatus(msg.status);
    } else if (msg.type === 'eval.output') {
      setLines((prev) => [...prev, msg].slice(-MAX_LINES));
    } else if (msg.type === 'eval.status') {
      if (msg.state === 'running') setLines([]);
      setStatus(msg);
      if (msg.state !== 'running') {
        void qc.invalidateQueries({ queryKey: evalsKey(spaceId) });
        if (msg.state === 'done' && msg.runId) done.current(msg.runId);
      }
    }
  });
  return { status, lines };
}

const evalUrl = (spaceId: string, tail: string) =>
  `/api/spaces/${spaceId}/evals/${tail}`;

export const startEval = (spaceId: string, req: EvalRunRequest) =>
  request('POST', evalUrl(spaceId, 'run'), req);
export const cancelEval = (spaceId: string) =>
  request('POST', evalUrl(spaceId, 'cancel'));
export const trustEval = (spaceId: string) =>
  request('PUT', evalUrl(spaceId, 'trust'), { trusted: true });

/** Pins `runId` as the baseline of `caseName`; null unpins. */
export function useSetBaseline(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { case: string; runId: string | null }) =>
      request('PUT', evalUrl(spaceId, 'baseline'), v),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalsKey(spaceId) }),
  });
}

export type TraceTarget = { runId: string; case: string; arm: 'with' | 'without'; n: number };

/** Parsed trace of one arm run (server `GET …/evals/runs/<id>/trace`). */
export const useEvalTrace = (spaceId: string, t: TraceTarget) =>
  useQuery({
    queryKey: [...runKey(spaceId, t.runId), 'trace', t.case, t.arm, t.n],
    queryFn: () =>
      request(
        'GET',
        `/api/spaces/${spaceId}/evals/runs/${idPath(t.runId)}/trace?case=${encodeURIComponent(t.case)}&arm=${t.arm}&n=${t.n}`,
        undefined,
        TraceSchema,
      ),
  });

/** Saves the whole history of each case (all runs, metrics and traces) to `.plugin-master/exports/evals/<case>/`; repeats write only changes. */
export const useExportCases = (spaceId: string) =>
  useMutation({
    mutationFn: (cases: string[]) =>
      request(
        'POST',
        `/api/spaces/${spaceId}/evals/export`,
        { cases },
        z.object({
          exports: z.array(
            z.object({ case: z.string(), dir: z.string(), written: z.number(), skipped: z.number(), total: z.number() }),
          ),
        }),
      ),
  });
