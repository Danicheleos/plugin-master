import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import { AppError } from '../lib/errors';

export const DEFAULT_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

function checkHost(req: FastifyRequest, config: Config): void {
  let hostname = '';
  try {
    hostname = new URL(`http://${req.headers.host ?? ''}`).hostname;
  } catch {
    // invalid Host header: rejected below
  }
  if (!(config.hosts ?? DEFAULT_HOSTS).includes(hostname))
    throw new AppError('FORBIDDEN_HOST', 'Host not allowed', 403);
}

function checkOrigin(
  req: FastifyRequest,
  config: Config,
  required: boolean,
): void {
  const origin = req.headers.origin;
  if (origin === undefined ? required : !config.webOrigins.includes(origin)) {
    throw new AppError('FORBIDDEN_ORIGIN', 'Origin not allowed', 403);
  }
}

function checkToken(given: unknown, config: Config): void {
  const digest = (s: string) => createHash('sha256').update(s).digest();
  if (
    typeof given !== 'string' ||
    !timingSafeEqual(digest(given), digest(config.token))
  ) {
    throw new AppError('UNAUTHORIZED', 'Invalid or missing token', 401);
  }
}

export function registerGuard(app: FastifyInstance, config: Config): void {
  app.addHook('onRequest', async (req) => {
    checkHost(req, config);
    checkOrigin(req, config, false);
  });
}

/** Token hook for the encapsulated `/api` plugin (matches the decoded route, not the raw URL). */
export function registerApiToken(app: FastifyInstance, config: Config): void {
  app.addHook('onRequest', async (req) => {
    checkToken(
      /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1],
      config,
    );
  });
}

/** For the WS upgrade: Origin is mandatory, token comes from the `?token=` query. */
export function verifyWsRequest(req: FastifyRequest, config: Config): void {
  checkHost(req, config);
  checkOrigin(req, config, true);
  checkToken((req.query as { token?: unknown }).token, config);
}
