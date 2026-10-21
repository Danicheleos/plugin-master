import { CreatePlanSchema, SetActivePlanSchema } from '@pm/protocol';
import type { FastifyPluginAsync } from 'fastify';
import type { Registry } from '../spaces/registry';
import type { PlansService } from './service';

export const plansRoutes =
  (
    registry: Registry,
    plansFor: (spaceId: string, root: string) => PlansService,
  ): FastifyPluginAsync =>
  async (app) => {
    const service = async (id: string) =>
      plansFor(id, (await registry.get(id)).path);

    app.get<{ Params: { id: string } }>('/spaces/:id/plans', async (req) =>
      (await service(req.params.id)).list(),
    );

    app.post<{ Params: { id: string } }>(
      '/spaces/:id/plans',
      async (req, reply) => {
        const plan = await (
          await service(req.params.id)
        ).create(CreatePlanSchema.parse(req.body));
        return reply.code(201).send(plan);
      },
    );

    app.put<{ Params: { id: string } }>(
      '/spaces/:id/plans/active',
      async (req, reply) => {
        const svc = await service(req.params.id);
        await svc.setActive(SetActivePlanSchema.parse(req.body).id);
        return reply.send(await svc.list());
      },
    );
  };
