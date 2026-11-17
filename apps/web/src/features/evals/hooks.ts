import { z } from 'zod';
import { useState } from 'react';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  EvalBaselinePinSchema,
  EvalGroupResponseSchema,
  EvalRunResponseSchema,
  EvalRunsResponseSchema,
  EvalTrustSchema,
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
import { IGNORED, request, requestText } from '../../api/http';
import { idParts, query, spaceUrl } from '../../api/space';
import { useSpaceEvents } from '../../api/ws';
import { configKey } from '../context';

export const evalsKey = (spaceId: string) => ['evals', spaceId];
const runKey = (spaceId: string, runId: string) => [
  ...evalsKey(spaceId),
  'run',
  runId,
];
export const evalRunsKey = (spaceId: string) => [...evalsKey(spaceId), 'runs'];
export const evalSuitesKey = (spaceId: string) => [
  ...evalsKey(spaceId),
  'suites',
];
export const evalTargetsKey = (spaceId: string) => [
  ...evalsKey(spaceId),
  'targets',
];

/** Everything that derives from the result files: runs list, suites, targets and every run view (not the suite definition). */
export const evalResultKeys = (spaceId: string) => [
  evalRunsKey(spaceId),
  evalSuitesKey(spaceId),
  evalTargetsKey(spaceId),
  [...evalsKey(spaceId), 'run'],
];

const evalUrl = (spaceId: string, ...parts: string[]) =>
  spaceUrl(spaceId, 'evals', ...parts);

const EXTERNAL_POLL_MS = 5000;
const ExportResponseSchema = z.object({
  exports: z.array(
    z.object({
      case: z.string(),
      dir: z.string(),
      written: z.number(),
      skipped: z.number(),
      total: z.number(),
    }),
  ),
});

export type TraceTarget = {
  runId: string;
  case: string;
  arm: 'with' | 'without';
  n: number;
};

export const evalQueries = {
  runs: (spaceId: string) =>
    queryOptions({
      queryKey: evalRunsKey(spaceId),
      queryFn: () =>
        request(
          'GET',
          evalUrl(spaceId, 'runs'),
          undefined,
          EvalRunsResponseSchema,
        ),
    }),
  suites: (spaceId: string) =>
    queryOptions({
      queryKey: evalSuitesKey(spaceId),
      queryFn: () =>
        request(
          'GET',
          evalUrl(spaceId, 'suites'),
          undefined,
          EvalSuitesResponseSchema,
        ),
    }),
  targets: (spaceId: string) =>
    queryOptions({
      queryKey: evalTargetsKey(spaceId),
      queryFn: () =>
        request(
          'GET',
          evalUrl(spaceId, 'targets'),
          undefined,
          EvalTargetsResponseSchema,
        ),
    }),
  suite: (spaceId: string) =>
    queryOptions({
      queryKey: [...evalsKey(spaceId), 'suite'],
      queryFn: () =>
        request('GET', evalUrl(spaceId, 'suite'), undefined, EvalSuiteSchema),
    }),
  /** One run, or with `group` the merged view of the group whose first run is `runId`. */
  run: (spaceId: string, runId: string, group = false) =>
    queryOptions({
      queryKey: group
        ? [...runKey(spaceId, runId), 'group']
        : runKey(spaceId, runId),
      queryFn: (): Promise<EvalRunResponse & { group?: EvalGroup }> =>
        request(
          'GET',
          evalUrl(spaceId, group ? 'groups' : 'runs', ...idParts(runId)),
          undefined,
          group ? EvalGroupResponseSchema : EvalRunResponseSchema,
        ),
    }),
  /** The report is fetched with the token and shown via `srcdoc`: a plain iframe `src` carries no auth header. */
  report: (spaceId: string, runId: string) =>
    queryOptions({
      queryKey: [...runKey(spaceId, runId), 'report'],
      queryFn: () => requestText(evalUrl(spaceId, 'report', ...idParts(runId))),
    }),
  /** Parsed trace of one arm run (server `GET …/evals/runs/<id>/trace`). */
  trace: (spaceId: string, t: TraceTarget) =>
    queryOptions({
      queryKey: [...runKey(spaceId, t.runId), 'trace', t.case, t.arm, t.n],
      queryFn: () =>
        request(
          'GET',
          evalUrl(spaceId, 'runs', ...idParts(t.runId), 'trace') +
            query({ case: t.case, arm: t.arm, n: t.n }),
          undefined,
          TraceSchema,
        ),
    }),
};

/** `enabled` false: the workspace only needs the eval dir while the Evals tab is open. */
export const useEvalRuns = (spaceId: string, enabled = true) =>
  useQuery({
    ...evalQueries.runs(spaceId),
    enabled,
    // an external series has no WS event of its own: poll while one is live
    refetchInterval: (q) => (q.state.data?.external ? EXTERNAL_POLL_MS : false),
  });

export const useEvalSuites = (spaceId: string) =>
  useQuery(evalQueries.suites(spaceId));
export const useEvalTargets = (spaceId: string) =>
  useQuery(evalQueries.targets(spaceId));
export const useEvalSuite = (spaceId: string) =>
  useQuery(evalQueries.suite(spaceId));

export const useEvalRun = (
  spaceId: string,
  runId: string,
  group = false,
  enabled = true,
) => useQuery({ ...evalQueries.run(spaceId, runId, group), enabled });

export const useEvalReport = (spaceId: string, runId: string) =>
  useQuery(evalQueries.report(spaceId, runId));

export const useEvalTrace = (spaceId: string, t: TraceTarget) =>
  useQuery(evalQueries.trace(spaceId, t));

const MAX_LINES = 500;
const idle: EvalStatus = { state: 'idle' };

/**
 * Live state of the eval process of a space (WS `eval.*`); `onDone` gets the id of a finished run.
 * NOTE: when a run ends it also invalidates the queries that derive from results (not the suite definition),
 * and only the finished run's views.
 */
export function useEvalLive(spaceId: string, onDone: (runId: string) => void) {
  const [status, setStatus] = useState<EvalStatus>(idle);
  const [lines, setLines] = useState<EvalLine[]>([]);
  const qc = useQueryClient();
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
        // the finished run's views are new; other runs' views are unchanged
        for (const queryKey of [
          evalRunsKey(spaceId),
          evalSuitesKey(spaceId),
          evalTargetsKey(spaceId),
        ])
          void qc.invalidateQueries({ queryKey });
        if (msg.runId)
          void qc.invalidateQueries({ queryKey: runKey(spaceId, msg.runId) });
        if (msg.state === 'done' && msg.runId) onDone(msg.runId);
      }
    }
  });
  return { status, lines };
}

/** The new status arrives over WS (`eval.status`); the answer is not used. */
export const startEval = (spaceId: string, req: EvalRunRequest) =>
  request('POST', evalUrl(spaceId, 'run'), req, IGNORED).then(() => undefined);
export const cancelEval = (spaceId: string) =>
  request<void>('POST', evalUrl(spaceId, 'cancel'));
export const trustEval = (spaceId: string) =>
  request('PUT', evalUrl(spaceId, 'trust'), { trusted: true }, EvalTrustSchema);

/**
 * Pins `runId` as the baseline of `caseName`; null unpins. The pin shows in the suites and targets
 * lists and in the space config (`evalBaselines`); runs and run views do not change.
 */
export function useSetBaseline(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { case: string; runId: string | null }) =>
      request('PUT', evalUrl(spaceId, 'baseline'), v, EvalBaselinePinSchema),
    onSettled: () =>
      Promise.all(
        [
          evalSuitesKey(spaceId),
          evalTargetsKey(spaceId),
          configKey(spaceId),
        ].map((queryKey) => qc.invalidateQueries({ queryKey })),
      ),
  });
}

/** Saves the whole history of each case (all runs, metrics and traces) to `.plugin-master/exports/evals/<case>/`; repeats write only changes. */
export const useExportCases = (spaceId: string) =>
  useMutation({
    mutationFn: (cases: string[]) =>
      request(
        'POST',
        evalUrl(spaceId, 'export'),
        { cases },
        ExportResponseSchema,
      ),
  });
