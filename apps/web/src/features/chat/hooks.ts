import { useState } from 'react';
import type { ChatEvent, ChatStatus, ServerMessage } from '@pm/protocol';
import { send, useSpaceEvents } from '../../api/ws';

type Permission = Extract<ServerMessage, { type: 'permission.request' }>;

/** Chat state of a space, assembled from `chat.*`, `permission.request` and `error` messages. */
export function useChat(spaceId: string) {
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [contextFiles, setContextFiles] = useState<string[] | null>(null);
  const [missingContext, setMissingContext] = useState<string[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [permissions, setPermissions] = useState<Permission[]>([]);

  useSpaceEvents(spaceId, (msg) => {
    switch (msg.type) {
      case 'chat.history':
        setEvents(msg.events);
        setStatus(msg.status);
        setContextFiles(msg.contextFiles);
        setMissingContext(msg.missingContext);
        setPermissions([]); // the server re-sends pending requests after the history
        break;
      case 'chat.event':
        setEvents((e) => [...e, msg.event]);
        break;
      case 'chat.status':
        setStatus(msg.status);
        setContextFiles(msg.contextFiles);
        setMissingContext(msg.missingContext);
        // idle means the server settled any open request (interrupt, reset, other tab)
        if (msg.status === 'idle') setPermissions([]);
        break;
      case 'permission.request':
        setPermissions((p) => [...p, msg]);
        break;
      case 'error':
        setEvents((e) => [...e, { kind: 'error', message: msg.message }]);
        break;
    }
  });

  return {
    events,
    status,
    contextFiles,
    missingContext,
    permission: permissions[0],
    send: (text: string) => send({ type: 'chat.send', spaceId, text }),
    interrupt: () => send({ type: 'chat.interrupt', spaceId }),
    reset: () => send({ type: 'chat.reset', spaceId }),
    reply: (requestId: string, allow: boolean) => {
      send({ type: 'permission.reply', requestId, allow });
      setPermissions((p) => p.filter((x) => x.requestId !== requestId));
    },
  };
}
