import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireFeature } from '../features/service';
import type { Registry } from '../spaces/registry';
import {
  gitBranches,
  gitCommit,
  gitCreateBranch,
  gitDiff,
  gitInit,
  gitLog,
  gitStatus,
  gitSwitch,
} from './service';

const CommitSchema = z.object({
  message: z.string().trim().min(1),
  paths: z.array(z.string()).optional(),
});
const BranchSchema = z.object({ name: z.string(), from: z.string().optional() });
const SwitchSchema = z.object({ name: z.string(), carry: z.boolean().optional() });

/** All routes need the `git` feature; `onChange` = after commit/branch/switch. */
export const gitRoutes =
  (registry: Registry, onChange: (spaceId: string) => void): FastifyPluginAsync =>
  async (app) => {
    type Req<Q = unknown> = { Params: { id: string }; Querystring: Q };
    /** Space root, with the feature gate applied. */
    const root = async (id: string) => {
      const { path } = await registry.get(id);
      await requireFeature(path, 'git');
      return path;
    };
    const changed = async <T>(id: string, p: Promise<T>) => {
      const res = await p;
      onChange(id);
      return res;
    };
    const url = (s: string) => `/spaces/:id/git/${s}`;

    app.get<Req>(url('status'), async (r) => gitStatus(await root(r.params.id)));
    app.post<Req>(url('init'), async (r) =>
      changed(r.params.id, gitInit(await root(r.params.id))),
    );
    app.get<Req<{ path?: string }>>(url('diff'), async (r) =>
      gitDiff(await root(r.params.id), z.string().min(1).parse(r.query.path)),
    );
    app.get<Req<{ limit?: string }>>(url('log'), async (r) =>
      gitLog(await root(r.params.id), Number(r.query.limit ?? 30)),
    );
    app.get<Req>(url('branches'), async (r) =>
      gitBranches(await root(r.params.id)),
    );
    app.post<Req>(url('commit'), async (r) => {
      const { message, paths } = CommitSchema.parse(r.body);
      return changed(r.params.id, gitCommit(await root(r.params.id), message, paths));
    });
    app.post<Req>(url('branch'), async (r) => {
      const { name, from } = BranchSchema.parse(r.body);
      return changed(r.params.id, gitCreateBranch(await root(r.params.id), name, from));
    });
    app.post<Req>(url('switch'), async (r) => {
      const { name, carry } = SwitchSchema.parse(r.body);
      return changed(r.params.id, gitSwitch(await root(r.params.id), name, carry));
    });
  };
