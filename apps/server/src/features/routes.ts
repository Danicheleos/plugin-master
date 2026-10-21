import { FeaturesInputSchema, type Features } from '@pm/protocol';
import type { FastifyPluginAsync } from 'fastify';
import type { Registry } from '../spaces/registry';
import { getFeatures, setFeatures } from './service';

export const featuresRoutes =
  (
    registry: Registry,
    onChange: (spaceId: string, features: Features) => void,
  ): FastifyPluginAsync =>
  async (app) => {
    const url = '/spaces/:id/features';
    type Req = { Params: { id: string } };

    app.get<Req>(url, async (req) =>
      getFeatures((await registry.get(req.params.id)).path),
    );

    app.put<Req>(url, async (req) => {
      const { path } = await registry.get(req.params.id);
      const features = await setFeatures(path, FeaturesInputSchema.parse(req.body));
      onChange(req.params.id, features);
      return features;
    });
  };
