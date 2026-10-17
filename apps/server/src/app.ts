import websocket from '@fastify/websocket';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { z, ZodError } from 'zod';
import type { Config } from './config';
import { AppError } from './lib/errors';
import { filesRoutes } from './files/routes';
import { watchSpaces } from './files/watcher';
import { registerApiToken, registerGuard } from './security/guard';
import { createSessionManager } from './claude/session-manager';
import { createRegistry } from './spaces/registry';
import { spacesRoutes } from './spaces/routes';
import { createSpacesService } from './spaces/service';
import { createHub } from './ws/hub';

export function buildApp(
  config: Config,
  logger: FastifyServerOptions['logger'] = false,
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
  const registry = createRegistry(config.home);
  const spaces = createSpacesService(registry);
  const hub = createHub(config);
  const watcher = watchSpaces(hub, registry);
  const chat = createSessionManager(hub, registry);
  app.addHook('onClose', async () => {
    chat.close();
    await watcher.close();
  });
  app.register(hub.plugin);
  app.register(
    async (api) => {
      registerApiToken(api, config);
      await api.register(spacesRoutes(spaces));
      await api.register(filesRoutes(registry));
    },
    { prefix: '/api' },
  );
  return app;
}
