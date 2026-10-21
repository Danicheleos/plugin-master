import {
  ClientMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from '@pm/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { z, ZodError } from 'zod';
import type { Config } from '../config';
import { verifyWsRequest } from '../security/guard';

/** A connected socket, as seen by handlers. */
export type Client = { send(msg: ServerMessage): void };
type Result = void | Promise<void>;
type MessageType = Exclude<ClientMessage['type'], 'subscribe' | 'unsubscribe'>;
type LeaveHandler = (spaceId: string, c: Client) => void;

/** The space a raw client message refers to, if it is parseable and has one. */
function spaceIdOf(raw: string): string | undefined {
  try {
    const id = (JSON.parse(raw) as { spaceId?: unknown }).spaceId;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `plugin` needs `@fastify/websocket` registered on the root instance before the
 * guard hook: its onResponse hook destroys the sockets of rejected upgrades.
 */
export function createHub(config: Config) {
  const spacesBySocket = new Map<Client, Set<string>>();
  const handlers = new Map<string, (m: ClientMessage, c: Client) => Result>();
  const subscribeHandlers: ((spaceId: string, c: Client) => Result)[] = [];
  const idleHandlers: ((spaceId: string) => void)[] = [];
  const leaveHandlers: LeaveHandler[] = [];

  const hasSubscribers = (spaceId: string) =>
    [...spacesBySocket.values()].some((s) => s.has(spaceId));

  async function dispatch(raw: string, client: Client, subs: Set<string>) {
    const msg = ClientMessageSchema.parse(JSON.parse(raw));
    if (msg.type === 'subscribe') {
      subs.add(msg.spaceId);
      for (const h of subscribeHandlers) await h(msg.spaceId, client);
      return;
    }
    if (msg.type === 'unsubscribe') {
      subs.delete(msg.spaceId);
      leaveHandlers.forEach((h) => h(msg.spaceId, client));
      if (!hasSubscribers(msg.spaceId))
        idleHandlers.forEach((h) => h(msg.spaceId));
      return;
    }
    // a watch of an unsubscribed space would never be released on disconnect
    if (msg.type === 'fs.watch' && !subs.has(msg.spaceId))
      throw new Error('Not subscribed to this space');
    const handler = handlers.get(msg.type);
    if (!handler) throw new Error(`Unsupported message type: ${msg.type}`);
    await handler(msg, client);
  }

  const plugin: FastifyPluginAsync = async (app) => {
    // Route-based hook: Fastify has already decoded/normalized the path, so
    // `/%77s` cannot skip the check the way a raw `req.url` prefix test could.
    app.get(
      '/ws',
      {
        websocket: true,
        onRequest: async (req) => verifyWsRequest(req, config),
      },
      (socket) => {
        const subs = new Set<string>();
        const client: Client = {
          send: (m) => socket.send(JSON.stringify(m)),
        };
        spacesBySocket.set(client, subs);
        socket.on('message', (data) => {
          dispatch(data.toString(), client, subs).catch((e: unknown) => {
            client.send({
              type: 'error',
              spaceId: spaceIdOf(data.toString()),
              message:
                e instanceof ZodError
                  ? z.prettifyError(e)
                  : e instanceof Error
                    ? e.message
                    : 'Invalid message',
            });
          });
        });
        socket.on('close', () => {
          spacesBySocket.delete(client);
          for (const id of subs) {
            leaveHandlers.forEach((h) => h(id, client));
            if (!hasSubscribers(id)) idleHandlers.forEach((h) => h(id));
          }
        });
      },
    );
  };

  return {
    plugin,
    broadcast(spaceId: string, msg: ServerMessage): void {
      for (const [client, subs] of spacesBySocket)
        if (subs.has(spaceId)) client.send(msg);
    },
    on<T extends MessageType>(
      type: T,
      handler: (msg: Extract<ClientMessage, { type: T }>, c: Client) => Result,
    ): void {
      handlers.set(type, handler as (m: ClientMessage, c: Client) => Result);
    },
    onSubscribe(handler: (spaceId: string, c: Client) => Result): void {
      subscribeHandlers.push(handler);
    },
    /** Called when a client unsubscribes from a space or disconnects. */
    onLeave(handler: LeaveHandler): void {
      leaveHandlers.push(handler);
    },
    /** Called when the last subscriber of a space disconnects. */
    onIdle(handler: (spaceId: string) => void): void {
      idleHandlers.push(handler);
    },
  };
}

export type Hub = ReturnType<typeof createHub>;
