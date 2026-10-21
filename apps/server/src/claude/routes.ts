import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../lib/errors';
import type { Registry } from '../spaces/registry';
import type { History } from './history';

export const sessionsRoutes =
  (registry: Registry, history: History): FastifyPluginAsync =>
  async (app) => {
    // every Claude Code session on this machine, for the "Open trace file" picker
    app.get('/claude/sessions', async () => history.all());
    app.get<{ Params: { sessionId: string } }>('/claude/sessions/:sessionId/trace', async (req) => {
      const trace = await history.trace(req.params.sessionId);
      if (!trace) throw new AppError('SESSION_NOT_FOUND', 'Session not found', 404);
      return trace;
    });

    app.get<{ Params: { id: string } }>('/spaces/:id/sessions', async (req) =>
      history.list((await registry.get(req.params.id)).path),
    );
  };
