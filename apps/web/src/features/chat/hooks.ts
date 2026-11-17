import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { z } from 'zod';
import {
  SessionInfoSchema,
  type ChatEffort,
  type ChatMode,
  type ChatModel,
  type ChatStatus,
} from '@pm/protocol';
import { request } from '../../api/http';
import { send, useSpaceEvents } from '../../api/ws';
import { chatReducer, initialChatState } from './reducer';

export type { AgentStats } from './reducer';

export type ChatActions = ReturnType<typeof makeActions>;

const makeActions = (
  spaceId: string,
  answered: (requestId: string) => void,
) => ({
  send: (text: string) => send({ type: 'chat.send', spaceId, text }),
  interrupt: () => send({ type: 'chat.interrupt', spaceId }),
  resume: (id: string) => send({ type: 'chat.resume', spaceId, sessionId: id }),
  setMode: (mode: ChatMode) => send({ type: 'chat.mode', spaceId, mode }),
  setModel: (model: ChatModel) => send({ type: 'chat.model', spaceId, model }),
  setEffort: (effort: ChatEffort) =>
    send({ type: 'chat.effort', spaceId, effort }),
  reset: () => send({ type: 'chat.reset', spaceId }),
  reply: (requestId: string, allow: boolean) => {
    send({ type: 'permission.reply', requestId, allow });
    answered(requestId);
  },
});

/** Chat state of a space (see `chatReducer`) and its actions, which are stable per space. */
export function useChat(spaceId: string) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  useSpaceEvents(spaceId, dispatch);
  const actions = useMemo(
    () =>
      makeActions(spaceId, (requestId) =>
        dispatch({ type: 'permission.answered', requestId }),
      ),
    [spaceId],
  );
  return { state, actions };
}

const sessionsKey = (spaceId: string) => ['sessions', spaceId];

/** Past sessions of the space; refetched when the live session changes or a turn ends (not when one starts). */
export function useSessions(
  spaceId: string,
  sessionId: string | null,
  status: ChatStatus,
) {
  const qc = useQueryClient();
  const was = useRef(status);
  useEffect(() => {
    if (was.current === 'running' && status === 'idle')
      void qc.invalidateQueries({ queryKey: sessionsKey(spaceId) });
    was.current = status;
  }, [qc, spaceId, status]);
  return useQuery({
    queryKey: [...sessionsKey(spaceId), sessionId],
    placeholderData: keepPreviousData, // no empty switcher flash while refetching
    queryFn: () =>
      request(
        'GET',
        `/api/spaces/${spaceId}/sessions`,
        undefined,
        z.array(SessionInfoSchema),
      ),
  });
}

/** Deletes a past session (its transcript and recorded run); the open one is refused by the server. */
export function useDeleteSession(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(
        'DELETE',
        `/api/spaces/${spaceId}/sessions/${encodeURIComponent(id)}`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: sessionsKey(spaceId) }),
  });
}
