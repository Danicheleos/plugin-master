import { FileContentSchema } from '@pm/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Registry } from '../spaces/registry';
import { create, read, tree, write } from './service';

const QuerySchema = FileContentSchema.pick({ path: true });

export const filesRoutes =
  (registry: Registry): FastifyPluginAsync =>
  async (app) => {
    type Req = { Params: { id: string } };
    const rootOf = async (id: string) => (await registry.get(id)).path;

    app.get<Req>('/spaces/:id/tree', async (req) =>
      tree(
        await rootOf(req.params.id),
        z.object({ dir: z.string().default('') }).parse(req.query).dir,
      ),
    );

    app.get<Req>('/spaces/:id/file', async (req) =>
      read(await rootOf(req.params.id), QuerySchema.parse(req.query).path),
    );

    app.post<Req>('/spaces/:id/file', async (req, reply) => {
      const { path, content } = FileContentSchema.parse(req.body);
      await create(await rootOf(req.params.id), path, content);
      return reply.code(201).send();
    });

    app.put<Req>('/spaces/:id/file', async (req, reply) => {
      const { path, content } = FileContentSchema.parse(req.body);
      await write(await rootOf(req.params.id), path, content);
      return reply.code(204).send();
    });
  };
