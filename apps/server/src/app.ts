import { homedir } from 'node:os';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { z, ZodError } from 'zod';
import type { Config } from './config';
import { AppError } from './lib/errors';
import { evalsRoutes } from './evals/routes';
import { createEvalRunner, type Spawner } from './evals/runner';
import { browseRoutes } from './files/browse';
import { filesRoutes } from './files/routes';
import { watchSpaces } from './files/watcher';
import { registerApiToken, registerGuard } from './security/guard';
import { sdkHistory, type History } from './claude/history';
import { sessionsRoutes } from './claude/routes';
import { createSessionManager } from './claude/session-manager';
import { createRecorder } from './runs/recorder';
import { runsRoutes } from './runs/routes';
import { hooksRoutes } from './hooks/routes';
import { createExperimentLoop } from './experiments/loop';
import { experimentsRoutes } from './experiments/routes';
import { featuresRoutes } from './features/routes';
import { gitRoutes } from './git/routes';
import { versionsRoutes } from './versions/routes';
import { plansRoutes } from './plans/routes';
import { createPlansService } from './plans/service';
import { createRegistry } from './spaces/registry';
import { spacesRoutes } from './spaces/routes';
import { createSpacesService } from './spaces/service';
import { flushTraceCache, setTraceCacheHome } from './evals/trace-cache';
import { createHub } from './ws/hub';

export function buildApp(
  config: Config,
  logger: FastifyServerOptions['logger'] = false,
  history: History = sdkHistory,
  spawnEval?: Spawner,
) {
  const app = Fastify({ logger });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const e =
      err instanceof AppError
        ? err
        : err instanceof ZodError
          ? new AppError('VALIDATION_ERROR', z.prettifyError(err), 400)
          : new AppError(
              err.statusCode && err.statusCode < 500
                ? 'BAD_REQUEST'
                : 'INTERNAL',
              err.message,
              err.statusCode ?? 500,
            );
    if (e.status >= 500) app.log.error(err);
    return reply
      .code(e.status)
      .send({ error: { code: e.code, message: e.message } });
  });

  app.setNotFoundHandler(() => {
    throw new AppError('NOT_FOUND', 'Route not found', 404);
  });

  // Before the guard: its onRequest/onResponse hooks must see upgrade requests the guard rejects.
  app.register(websocket);
  registerGuard(app, config);
  setTraceCacheHome(config.home);
  const registry = createRegistry(config.home);
  const spaces = createSpacesService(registry);
  const hub = createHub(config);
  const watcher = watchSpaces(hub, registry, (e) =>
    app.log.error(e, 'file watcher error'),
  );
  const recorder = createRecorder((e) => app.log.error(e, 'run recorder'));
  const evalRunner = createEvalRunner(hub, spawnEval);
  const chat = createSessionManager(hub, registry, undefined, history, recorder, {
    runner: evalRunner,
    busy: (spaceId) => experimentLoop.busy(spaceId),
  });
  const experimentLoop = createExperimentLoop({
    evalRunner,
    permissions: chat.permissions,
    recorder,
    onChange: (spaceId) => hub.broadcast(spaceId, { type: 'experiments.changed', spaceId }),
    onError: (e) => app.log.error(e, 'experiment loop'),
  });
  app.addHook('onClose', async () => {
    experimentLoop.close();
    chat.close();
    evalRunner.close();
    await watcher.close();
    await flushTraceCache();
  });
  app.register(hub.plugin);
  app.register(
    async (api) => {
      registerApiToken(api, config);
      await api.register(spacesRoutes(spaces));
      await api.register(filesRoutes(registry));
      await api.register(evalsRoutes(registry, evalRunner, experimentLoop.busy));
      await api.register(
        plansRoutes(registry, (spaceId, root) =>
          createPlansService(root, () =>
            hub.broadcast(spaceId, { type: 'plans.changed', spaceId }),
          ),
        ),
      );
      await api.register(sessionsRoutes(registry, history));
      await api.register(runsRoutes(registry));
      await api.register(hooksRoutes(registry));
      await api.register(
        featuresRoutes(registry, (spaceId, features) =>
          hub.broadcast(spaceId, { type: 'features.changed', spaceId, features }),
        ),
      );
      await api.register(
        gitRoutes(registry, (spaceId) =>
          hub.broadcast(spaceId, { type: 'git.changed', spaceId }),
        ),
      );
      await api.register(versionsRoutes(registry));
      await api.register(
        experimentsRoutes(registry, config.home, (spaceId) =>
          hub.broadcast(spaceId, { type: 'experiments.changed', spaceId }),
          experimentLoop,
        ),
      );
      await api.register(browseRoutes(config.userHome ?? homedir()));
    },
    { prefix: '/api' },
  );
  return app;
}
