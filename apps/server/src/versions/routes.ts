import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireFeature } from '../features/service';
import type { Registry } from '../spaces/registry';
import { compareVersions, gateVersions, listVersions } from './service';

const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(30) });
const RefsQuery = z.object({ from: z.string().min(1), to: z.string().min(1) });

/** All routes need the `git` feature. */
export const versionsRoutes =
  (registry: Registry): FastifyPluginAsync =>
  async (app) => {
    type Req = { Params: { id: string }; Querystring: Record<string, string> };
    const root = async (id: string) => {
      const { path } = await registry.get(id);
      await requireFeature(path, 'git');
      return path;
    };
    const url = (s = '') => `/spaces/:id/versions${s}`;

    app.get<Req>(url(), async (r) =>
      listVersions(await root(r.params.id), ListQuery.parse(r.query).limit),
    );
    app.get<Req>(url('/compare'), async (r) => {
      const { from, to } = RefsQuery.parse(r.query);
      return compareVersions(await root(r.params.id), from, to);
    });
    app.get<Req>(url('/gate'), async (r) => {
      const { from, to } = RefsQuery.parse(r.query);
      return gateVersions(await root(r.params.id), from, to);
    });
  };
