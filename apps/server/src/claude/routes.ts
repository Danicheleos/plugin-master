import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../lib/errors';
import type { Registry } from '../spaces/registry';
import { recordedRun } from '../runs/service';
import type { History } from './history';
import { readSessionTrace } from './transcript';

export const sessionsRoutes =
  (
    registry: Registry,
    history: History,
    projects?: string,
  ): FastifyPluginAsync =>
  async (app) => {
    // every Claude Code session on this machine, for the "Open trace file" picker
    app.get('/claude/sessions', async () => history.all());
    app.get<{ Params: { sessionId: string } }>(
      '/claude/sessions/:sessionId/trace',
      async (req) => {
        // the raw transcript (looked up by id under `projects`, never by a client path), not
        // `getSessionMessages`: only the file has attachments and the system prompt snapshot
        const trace = await readSessionTrace(
          req.params.sessionId,
          await recordedRun(registry, req.params.sessionId),
          projects,
        );
        if (!trace)
          throw new AppError('SESSION_NOT_FOUND', 'Session not found', 404);
        return trace;
      },
    );

    app.get<{ Params: { id: string } }>('/spaces/:id/sessions', async (req) =>
      history.list((await registry.get(req.params.id)).path),
    );
  };
