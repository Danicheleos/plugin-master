import {
  CreateSpaceSchema,
  OpenSpaceSchema,
  SpaceConfigInputSchema,
} from '@pm/protocol';
import type { FastifyPluginAsync } from 'fastify';
import type { SpacesService } from './service';

export const spacesRoutes =
  (service: SpacesService): FastifyPluginAsync =>
  async (app) => {
    app.get('/spaces', () => service.list());

    app.post('/spaces', async (req, reply) => {
      const space = await service.create(CreateSpaceSchema.parse(req.body));
      return reply.code(201).send(space);
    });

    app.post('/spaces/open', (req) =>
      service.open(OpenSpaceSchema.parse(req.body)),
    );

    app.delete<{ Params: { id: string } }>(
      '/spaces/:id',
      async (req, reply) => {
        await service.remove(req.params.id);
        return reply.code(204).send();
      },
    );

    app.get<{ Params: { id: string } }>('/spaces/:id/config', (req) =>
      service.getConfig(req.params.id),
    );

    app.put<{ Params: { id: string } }>('/spaces/:id/config', (req) =>
      service.setConfig(req.params.id, SpaceConfigInputSchema.parse(req.body)),
    );
  };
