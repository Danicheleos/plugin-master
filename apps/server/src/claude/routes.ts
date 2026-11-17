import { rm } from 'node:fs/promises';
import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../lib/errors';
import type { Registry } from '../spaces/registry';
import { recordedRun } from '../runs/service';
import { RUN_ID, runDir } from '../runs/recorder';
import type { History } from './history';
import { readSessionTrace } from './transcript';

export const sessionsRoutes =
  (
    registry: Registry,
    history: History,
    projects?: string,
    /** session id of the conversation open in the space's chat (null = new session) */
    openSession: (spaceId: string) => string | null = () => null,
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

    // the session's transcript and its recorded run (`.plugin-master/runs/<id>`)
    app.delete<{ Params: { id: string; sessionId: string } }>(
      '/spaces/:id/sessions/:sessionId',
      async (req, reply) => {
        const { id, sessionId } = req.params;
        const { path } = await registry.get(id);
        if (openSession(id) === sessionId)
          throw new AppError(
            'SESSION_OPEN',
            'The open session cannot be deleted: switch to another session first',
            409,
          );
        if (!(await history.list(path)).some((s) => s.id === sessionId))
          throw new AppError('SESSION_NOT_FOUND', 'Session not found', 404);
        await history.remove(path, sessionId);
        if (RUN_ID.test(sessionId))
          await rm(runDir(path, sessionId), { recursive: true, force: true });
        return reply.code(204).send();
      },
    );
  };
