import { PutHooksSchema } from '@pm/protocol';
import type { FastifyPluginAsync } from 'fastify';
import type { Registry } from '../spaces/registry';
import { listHooks, putHooks } from './service';

export const hooksRoutes =
  (registry: Registry): FastifyPluginAsync =>
  async (app) => {
    const rootOf = async (id: string) => (await registry.get(id)).path;

    app.get<{ Params: { id: string } }>('/spaces/:id/hooks', async (req) =>
      listHooks(await rootOf(req.params.id)),
    );

    app.put<{ Params: { id: string } }>('/spaces/:id/hooks', async (req) =>
      putHooks(await rootOf(req.params.id), PutHooksSchema.parse(req.body)),
    );
  };
