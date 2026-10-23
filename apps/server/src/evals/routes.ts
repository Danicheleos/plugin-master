import {
  EvalBaselinePinSchema,
  EvalRunRequestSchema,
  EvalTrustSchema,
  type EvalRunsResponse,
  type EvalStatus,
} from '@pm/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { readConfig, withLock, writeConfig } from '../spaces/config-file';
import { AppError } from '../lib/errors';
import type { Registry } from '../spaces/registry';
import { evalDir } from './eval-dir';
import { exportCase } from './export';
import { readExternalSeries } from './external';
import type { EvalRunner } from './runner';
import { readSuite } from './suite';
import { listTargets } from './targets';
import { listGroups, listSuites, readGroup, readReport, readRun, readRunTrace } from './results';

export const evalsRoutes =
  (
    registry: Registry,
    runner: EvalRunner,
    /** an experiment runs in the space: its eval stage uses the runner itself */
    experimentRunning: (spaceId: string) => boolean = () => false,
  ): FastifyPluginAsync =>
  async (app) => {
    type Req = { Params: { id: string; '*': string } };
    const rootOf = async (id: string) => (await registry.get(id)).path;

    app.get<Req>(
      '/spaces/:id/evals/runs',
      async (req): Promise<EvalRunsResponse> => {
        const root = await rootOf(req.params.id);
        return {
          dir: await evalDir(root),
          groups: await listGroups(root),
          external: await readExternalSeries(root),
        };
      },
    );

    app.get<Req>('/spaces/:id/evals/suites', async (req) =>
      listSuites(await rootOf(req.params.id)),
    );

    app.get<Req>('/spaces/:id/evals/targets', async (req) =>
      listTargets(await rootOf(req.params.id)),
    );

    app.get<Req>('/spaces/:id/evals/suite', async (req) =>
      readSuite(await rootOf(req.params.id)),
    );

    // run ids can be nested (`plugin-eval/x`), hence the wildcard; `/report` is a suffix
    app.get<Req>('/spaces/:id/evals/report/*', async (req, reply) =>
      reply
        .type('text/html')
        .header(
          'Content-Security-Policy',
          "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        )
        .send(await readReport(await rootOf(req.params.id), req.params['*'])),
    );

    app.post<Req>('/spaces/:id/evals/run', async (req): Promise<EvalStatus> => {
      const root = await rootOf(req.params.id);
      if (experimentRunning(req.params.id))
        throw new AppError('EXPERIMENT_RUNNING', 'An experiment is running in this space', 409);
      return runner.start(req.params.id, root, EvalRunRequestSchema.parse(req.body));
    });

    app.post<Req>('/spaces/:id/evals/cancel', async (req, reply) => {
      await rootOf(req.params.id);
      runner.cancel(req.params.id);
      return reply.code(204).send();
    });

    app.put<Req>('/spaces/:id/evals/trust', async (req) => {
      const root = await rootOf(req.params.id);
      const { trusted } = EvalTrustSchema.parse(req.body);
      await withLock(root, async () =>
        writeConfig(root, {
          ...(await readConfig(root)),
          evalTrusted: trusted,
        }),
      );
      return { trusted };
    });

    // pins one run as the baseline of a case; `runId: null` unpins
    app.put<Req>('/spaces/:id/evals/baseline', async (req) => {
      const root = await rootOf(req.params.id);
      const { case: name, runId } = EvalBaselinePinSchema.parse(req.body);
      return withLock(root, async () => {
        const config = await readConfig(root);
        const evalBaselines = { ...config.evalBaselines };
        if (runId) evalBaselines[name] = runId;
        else delete evalBaselines[name];
        await writeConfig(root, { ...config, evalBaselines });
        return { case: name, runId };
      });
    });

    app.get<Req>('/spaces/:id/evals/groups/*', async (req) =>
      readGroup(await rootOf(req.params.id), req.params['*']),
    );

    // body: { cases: string[] }; one folder per case with its whole run history
    app.post<{ Params: { id: string }; Body: { cases?: unknown } }>('/spaces/:id/evals/export', async (req) => {
      const root = await rootOf(req.params.id);
      const cases = req.body?.cases;
      if (!Array.isArray(cases) || !cases.length || cases.some((c) => typeof c !== 'string' || !c))
        throw new AppError('INVALID_EXPORT', 'Expected { cases: string[] }', 400);
      return { exports: await Promise.all((cases as string[]).map((c) => exportCase(root, c))) };
    });

    // `…/runs/<id>/trace?case=&arm=&n=`: the wildcard id is nested, so the suffix is split here
    app.get<Req & { Querystring: { case?: string; arm?: string; n?: string } }>(
      '/spaces/:id/evals/runs/*',
      async (req) => {
        const path = req.params['*'];
        const root = await rootOf(req.params.id);
        return path.endsWith('/trace')
          ? readRunTrace(root, path.slice(0, -'/trace'.length), req.query)
          : readRun(root, path);
      },
    );
  };
