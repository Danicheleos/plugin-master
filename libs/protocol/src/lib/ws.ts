import { z } from 'zod';
import type { ChatEvent, ChatStatus } from './chat.js';

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
      /** masterContext the session started with; null = no session */
      contextFiles: string[] | null;
      /** entries of contextFiles that did not exist at session start */
      missingContext: string[];
    }
  | { type: 'chat.event'; spaceId: string; event: ChatEvent }
  | {
      type: 'chat.status';
      spaceId: string;
      status: ChatStatus;
      /** masterContext the session started with; null = no session */
      contextFiles: string[] | null;
      /** entries of contextFiles that did not exist at session start */
      missingContext: string[];
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
