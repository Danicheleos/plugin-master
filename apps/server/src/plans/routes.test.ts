import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../lib/errors';
import { createRegistry } from '../spaces/registry';
import { plansRoutes } from './routes';
import { createPlansService } from './service';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pm-planroutes-'));
  await mkdir(join(root, '.plugin-master'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('plans routes', () => {
  it('lists, creates and switches plans, notifying on changes', async () => {
    const registry = createRegistry(root);
    await registry.add({ id: 's1', name: 'p', path: root, createdAt: '' });
    const notify = vi.fn();
    const app = Fastify();
    app.setErrorHandler((e: AppError, _r, reply) =>
      reply.code(e.status ?? 500).send({ error: e.message }),
    );
    await app.register(
      plansRoutes(registry, (_id, r) => createPlansService(r, notify)),
    );

    const empty = await app.inject('/spaces/s1/plans');
    expect(empty.json()).toEqual({ active: null, plans: [] });
    const a = await app.inject({
      method: 'POST',
      url: '/spaces/s1/plans',
      payload: { title: 'A', goal: 'g' },
    });
    expect(a.statusCode).toBe(201);
    const b = await app.inject({
      method: 'POST',
      url: '/spaces/s1/plans',
      payload: { title: 'B', goal: '' },
    });
    expect(notify).toHaveBeenCalledTimes(2);
    const sw = await app.inject({
      method: 'PUT',
      url: '/spaces/s1/plans/active',
      payload: { id: b.json().id },
    });
    expect(sw.json().active).toBe(b.json().id);
    const missing = await app.inject({
      method: 'PUT',
      url: '/spaces/s1/plans/active',
      payload: { id: 'zzz' },
    });
    expect(missing.statusCode).toBe(404);
    const invalid = await app.inject({
      method: 'POST',
      url: '/spaces/s1/plans',
      payload: { title: ' ', goal: '' },
    });
    expect(invalid.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });
});
