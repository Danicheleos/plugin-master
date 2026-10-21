import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { z } from 'zod';
import {
  SessionInfoSchema,
  type ChatEvent,
  type ChatMode,
  type ChatModel,
  type ChatStatus,
  type ServerMessage,
} from '@pm/protocol';
import { request } from '../../api/http';
import { send, useSpaceEvents } from '../../api/ws';

export type AgentStats = Omit<
  Extract<ServerMessage, { type: 'agent.stats' }>,
  'type' | 'spaceId'
>;
const NO_STATS: AgentStats = { master: null, current: null, tasks: [] };

type Permission = Extract<ServerMessage, { type: 'permission.request' }>;

/** Chat state of a space, assembled from `chat.*`, `permission.request` and `error` messages. */
export function useChat(spaceId: string) {
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [contextFiles, setContextFiles] = useState<string[] | null>(null);
  const [missingContext, setMissingContext] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [mode, setMode] = useState<ChatMode>('auto');
  const [model, setModel] = useState<ChatModel | null>(null); // null until the server answered
  const [stats, setStats] = useState<AgentStats>(NO_STATS);
  const [permissions, setPermissions] = useState<Permission[]>([]);

  useSpaceEvents(spaceId, (msg) => {
    switch (msg.type) {
      case 'chat.history':
        setEvents(msg.events);
        setStatus(msg.status);
        setMode(msg.mode);
        setModel(msg.model);
        setContextFiles(msg.contextFiles);
        setMissingContext(msg.missingContext);
        setSessionId(msg.sessionId);
        setPermissions([]); // the server re-sends pending requests after the history
        break;
      case 'chat.event':
        setEvents((e) => [...e, msg.event]);
        break;
      case 'chat.status':
        setStatus(msg.status);
        setMode(msg.mode);
        setModel(msg.model);
        setContextFiles(msg.contextFiles);
        setMissingContext(msg.missingContext);
        setSessionId(msg.sessionId);
        // idle means the server settled any open request (interrupt, reset, other tab)
        if (msg.status === 'idle') setPermissions([]);
        break;
      case 'agent.stats':
        setStats({
          master: msg.master,
          current: msg.current,
          tasks: msg.tasks,
        });
        break;
      case 'permission.request':
        setPermissions((p) => [...p, msg]);
        break;
      case 'error':
        setEvents((e) => [...e, { kind: 'error', message: msg.message }]);
        break;
    }
  });

  const sendText = useCallback(
    (text: string) => send({ type: 'chat.send', spaceId, text }),
    [spaceId],
  );
  const interrupt = useCallback(
    () => send({ type: 'chat.interrupt', spaceId }),
    [spaceId],
  );
  const changeModel = useCallback(
    (m: ChatModel) => send({ type: 'chat.model', spaceId, model: m }),
    [spaceId],
  );

  return {
    events,
    status,
    mode,
    model,
    stats,
    sessionId,
    contextFiles,
    missingContext,
    permission: permissions[0],
    send: sendText,
    interrupt,
    resume: (id: string) =>
      send({ type: 'chat.resume', spaceId, sessionId: id }),
    setMode: (m: ChatMode) => send({ type: 'chat.mode', spaceId, mode: m }),
    setModel: changeModel,
    reset: () => send({ type: 'chat.reset', spaceId }),
    reply: (requestId: string, allow: boolean) => {
      send({ type: 'permission.reply', requestId, allow });
      setPermissions((p) => p.filter((x) => x.requestId !== requestId));
    },
  };
}

/** Past sessions of the space; refetched when the live session changes or a turn ends. */
export const useSessions = (
  spaceId: string,
  sessionId: string | null,
  status: ChatStatus,
) =>
  useQuery({
    queryKey: ['sessions', spaceId, sessionId, status],
    placeholderData: keepPreviousData, // no empty switcher flash while refetching
    queryFn: () =>
      request(
        'GET',
        `/api/spaces/${spaceId}/sessions`,
        undefined,
        z.array(SessionInfoSchema),
      ),
  });
