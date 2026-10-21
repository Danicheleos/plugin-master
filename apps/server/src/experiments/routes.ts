import type { FastifyPluginAsync } from 'fastify';
import { CreateExperimentSchema, RunExperimentSchema } from '@pm/protocol';
import { requireFeature } from '../features/service';
import { AppError } from '../lib/errors';
import type { Registry } from '../spaces/registry';
import type { ExperimentLoop } from './loop';
import { writeMergeNotes } from './proposal';
import { readLedger, recordOutcome } from './ledger';
import { getExperiment, listExperiments } from './store';
import {
  createExperiment,
  diffExperiment,
  discardExperiment,
  mergeExperiment,
  worktreesDir,
} from './worktree';

const parseN = (s: string) => {
  if (!/^[1-9]\d{0,8}$/.test(s)) throw new AppError('INVALID_EXPERIMENT', 'Invalid experiment number', 400);
  return Number(s);
};

/** All routes need the `masterLoop` feature; `onChange` = after create/merge/discard. Reads settle records left `running` by a crash. */
export const experimentsRoutes =
  (
    registry: Registry,
    home: string,
    onChange: (spaceId: string) => void,
    loop: ExperimentLoop,
  ): FastifyPluginAsync =>
  async (app) => {
    type Req = { Params: { id: string; n?: string } };
    const ctx = async (id: string) => {
      const { path: root } = await registry.get(id);
      await requireFeature(root, 'masterLoop');
      return { root, dir: worktreesDir(home, id) };
    };
    const changed = async <T>(id: string, p: Promise<T>) => {
      const res = await p;
      onChange(id);
      return res;
    };
    const url = '/spaces/:id/experiments';

    app.get<Req>(url, async (r) => {
      const { root } = await ctx(r.params.id);
      return Promise.all((await listExperiments(root)).map((e) => loop.settle(r.params.id, root, e)));
    });
    app.get<Req & { Querystring: { skill?: string } }>(`${url}/ledger`, async (r) => {
      const { root } = await ctx(r.params.id);
      const { skill } = r.query;
      return (await readLedger(root)).filter((x) => !skill || x.skills.includes(skill)).slice(-200);
    });
    app.post<Req>(url, async (r) =>
      changed(r.params.id, createExperiment(await ctx(r.params.id), CreateExperimentSchema.parse(r.body ?? {}).hypothesis)),
    );
    app.get<Req>(`${url}/:n`, async (r) => {
      const { root } = await ctx(r.params.id);
      return loop.settle(r.params.id, root, await getExperiment(root, parseN(r.params.n!)));
    });
    app.get<Req>(`${url}/:n/diff`, async (r) =>
      diffExperiment(await ctx(r.params.id), parseN(r.params.n!)),
    );
    // the loop broadcasts its own changes
    app.post<Req>(`${url}/run`, async (r) =>
      loop.run(r.params.id, await ctx(r.params.id), RunExperimentSchema.parse(r.body ?? {})),
    );
    app.post<Req>(`${url}/:n/cancel`, async (r) => {
      const { root } = await ctx(r.params.id);
      const n = parseN(r.params.n!);
      loop.cancel(r.params.id, n);
      return getExperiment(root, n);
    });
    app.post<Req>(`${url}/:n/merge`, async (r) => {
      const c = await ctx(r.params.id);
      const n = parseN(r.params.n!);
      loop.assertIdle(r.params.id, n);
      const e = await changed(r.params.id, mergeExperiment(c, n));
      await writeMergeNotes(c.root, e);
      await recordOutcome(c.root, n, true);
      return e;
    });
    app.post<Req>(`${url}/:n/discard`, async (r) => {
      const n = parseN(r.params.n!);
      loop.assertIdle(r.params.id, n);
      const c = await ctx(r.params.id);
      const e = await changed(r.params.id, discardExperiment(c, n));
      await recordOutcome(c.root, n, false);
      return e;
    });
  };
