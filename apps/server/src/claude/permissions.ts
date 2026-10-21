import { randomUUID } from 'node:crypto';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import type { ServerMessage } from '@pm/protocol';

type Pending = {
  spaceId: string;
  msg: Extract<ServerMessage, { type: 'permission.request' }>;
  resolve: (allow: boolean) => void;
};

/** Bridges the SDK's `canUseTool` to the UI: no timeouts, no remembered decisions. */
export function createPermissions(
  broadcast: (spaceId: string, msg: ServerMessage) => void,
) {
  const pending = new Map<string, Pending>();

  function request(
    spaceId: string,
    toolName: string,
    input: unknown,
    signal?: AbortSignal,
    idPrefix = '',
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const requestId = idPrefix + randomUUID();
      const msg = {
        type: 'permission.request',
        spaceId,
        requestId,
        toolName,
        input,
      } as const;
      const settle = (allow: boolean) => {
        pending.delete(requestId);
        resolve(allow);
      };
      if (signal?.aborted) return resolve(false); // 'abort' would never fire
      pending.set(requestId, { spaceId, msg, resolve: settle });
      // an interrupted or closed session aborts the signal: drop the prompt
      signal?.addEventListener('abort', () => settle(false), { once: true });
      broadcast(spaceId, msg);
    });
  }

  return {
    request,
    reply(requestId: string, allow: boolean): void {
      pending.get(requestId)?.resolve(allow);
    },
    /** Requests still waiting for an answer, so a (re)subscribing client can show them. */
    pendingFor(spaceId: string): ServerMessage[] {
      return [...pending.values()]
        .filter((p) => p.spaceId === spaceId)
        .map((p) => p.msg);
    },
    canUseTool(spaceId: string): CanUseTool {
      return async (toolName, input, { signal }) =>
        (await request(spaceId, toolName, input, signal))
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: 'Denied by user' };
    },
  };
}

export type Permissions = ReturnType<typeof createPermissions>;
