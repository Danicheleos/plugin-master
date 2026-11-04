import type { FastifyPluginAsync } from 'fastify';
import type { Registry } from '../spaces/registry';
import { listRuns, readRunTrace } from './service';

export const runsRoutes =
  (registry: Registry, projects?: string): FastifyPluginAsync =>
  async (app) => {
    const rootOf = async (id: string) => (await registry.get(id)).path;

    app.get<{ Params: { id: string } }>('/spaces/:id/runs', async (req) =>
      listRuns(await rootOf(req.params.id)),
    );

    app.get<{ Params: { id: string; runId: string } }>(
      '/spaces/:id/runs/:runId/trace',
      async (req) =>
        readRunTrace(await rootOf(req.params.id), req.params.runId, projects),
    );
  };
