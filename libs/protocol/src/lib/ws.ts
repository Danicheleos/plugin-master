import { z } from 'zod';
import type { EvalLine, EvalStatus } from './evals.js';
import type { Features } from './rest.js';
import {
  CHAT_MODES,
  type AgentTask,
  type ChatEvent,
  type ChatMode,
  CHAT_MODEL_IDS,
  type ChatModel,
  type ChatStatus,
  type ContextUsage,
} from './chat.js';

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), spaceId: z.string() }),
  z.object({ type: z.literal('unsubscribe'), spaceId: z.string() }),
  z.object({
    type: z.literal('chat.send'),
    spaceId: z.string(),
    text: z.string(),
  }),
  z.object({ type: z.literal('chat.interrupt'), spaceId: z.string() }),
  z.object({ type: z.literal('chat.reset'), spaceId: z.string() }),
  z.object({
    type: z.literal('chat.mode'),
    spaceId: z.string(),
    mode: z.enum(CHAT_MODES),
  }),
  z.object({
    type: z.literal('chat.model'),
    spaceId: z.string(),
    model: z.enum(CHAT_MODEL_IDS),
  }),
  z.object({
    type: z.literal('chat.resume'),
    spaceId: z.string(),
    sessionId: z.string(),
  }),
  // the full set of paths (files and dirs, relative to the space root) this client wants watched
  z.object({
    type: z.literal('fs.watch'),
    spaceId: z.string(),
    paths: z.array(z.string()),
  }),
  z.object({
    type: z.literal('permission.reply'),
    requestId: z.string(),
    allow: z.boolean(),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type FsEvent = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

// Server messages are produced by our own code, so they are plain types (no zod).
export type ServerMessage =
  | { type: 'fs.changed'; spaceId: string; path: string; event: FsEvent }
  | {
      type: 'chat.history';
      spaceId: string;
      events: ChatEvent[];
      status: ChatStatus;
      /** permission mode of the space (applies to the live and the next session) */
      mode: ChatMode;
      /** model of the space (applies to the live and the next session) */
      model: ChatModel;
      /** masterContext the session started with; null = no session */
      contextFiles: string[] | null;
      /** entries of contextFiles that did not exist at session start */
      missingContext: string[];
      /** SDK session id; null = new session, nothing sent yet */
      sessionId: string | null;
    }
  | { type: 'chat.event'; spaceId: string; event: ChatEvent }
  | {
      type: 'chat.status';
      spaceId: string;
      status: ChatStatus;
      /** permission mode of the space (applies to the live and the next session) */
      mode: ChatMode;
      /** model of the space (applies to the live and the next session) */
      model: ChatModel;
      /** masterContext the session started with; null = no session */
      contextFiles: string[] | null;
      /** entries of contextFiles that did not exist at session start */
      missingContext: string[];
      /** SDK session id; null = new session, nothing sent yet */
      sessionId: string | null;
    }
  | { type: 'plans.changed'; spaceId: string }
  | { type: 'features.changed'; spaceId: string; features: Features }
  | { type: 'git.changed'; spaceId: string }
  | { type: 'experiments.changed'; spaceId: string }
  | ({ type: 'eval.output'; spaceId: string } & EvalLine)
  | ({ type: 'eval.status'; spaceId: string } & EvalStatus)
  /** Sent on subscribe: the buffered output (last lines) and the current status. */
  | {
      type: 'eval.history';
      spaceId: string;
      lines: EvalLine[];
      status: EvalStatus;
    }
  | {
      type: 'agent.stats';
      spaceId: string;
      /** context of the master session; null until known */
      master: ContextUsage | null;
      /** the master's current action while running; null when idle */
      current: string | null;
      tasks: AgentTask[];
    }
  | {
      type: 'permission.request';
      spaceId: string;
      requestId: string;
      toolName: string;
      input: unknown;
    }
  // spaceId is set when the error relates to a space's message
  | { type: 'error'; message: string; spaceId?: string };
