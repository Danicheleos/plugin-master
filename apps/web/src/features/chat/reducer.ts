import {
  chatWindowStart,
  type ChatEffort,
  type ChatEvent,
  type ChatMode,
  type ChatModel,
  type ChatStatus,
  type ServerMessage,
} from '@pm/protocol';

export type AgentStats = Omit<
  Extract<ServerMessage, { type: 'agent.stats' }>,
  'type' | 'spaceId'
>;
export type Permission = Extract<ServerMessage, { type: 'permission.request' }>;

/** The chat window: the last MAX_CHAT_ROWS rows, `earlier` = events dropped before them, `conversation` = chat.history count. */
export type ChatLog = {
  events: ChatEvent[];
  earlier: number;
  /** bumped by each chat.history: a conversation (re)appeared */
  conversation: number;
};

export type ChatSettings = {
  mode: ChatMode;
  /** null until the server answered */
  model: ChatModel | null;
  effort: ChatEffort;
  sessionId: string | null;
  contextFiles: string[] | null;
  missingContext: string[];
};

export type ChatState = ChatSettings & {
  log: ChatLog;
  status: ChatStatus;
  stats: AgentStats;
  permissions: Permission[];
};

export const NO_STATS: AgentStats = { master: null, current: null, tasks: [] };

export const initialChatState: ChatState = {
  log: { events: [], earlier: 0, conversation: 0 },
  status: 'idle',
  mode: 'auto',
  model: null,
  effort: 'default',
  sessionId: null,
  contextFiles: null,
  missingContext: [],
  stats: NO_STATS,
  permissions: [],
};

/** A server message, or the local answer to a permission request. */
export type ChatAction =
  ServerMessage | { type: 'permission.answered'; requestId: string };

/** Appends an event and drops the rows beyond the window, as the server does. */
function append(log: ChatLog, event: ChatEvent): ChatLog {
  const events = [...log.events, event];
  const start = chatWindowStart(events);
  return start
    ? { ...log, events: events.slice(start), earlier: log.earlier + start }
    : { ...log, events };
}

/** Keeps the previous array when the lists are equal, so unchanged settings do not re-render consumers. */
function stable<T extends string[] | null>(prev: T, next: T): T {
  return prev &&
    next &&
    prev.length === next.length &&
    prev.every((x, i) => x === next[i])
    ? prev
    : next;
}

type Session = Extract<ServerMessage, { type: 'chat.status' | 'chat.history' }>;

/** The part `chat.history` and `chat.status` share. */
function withSession(state: ChatState, msg: Session): ChatState {
  return {
    ...state,
    status: msg.status,
    mode: msg.mode,
    model: msg.model,
    effort: msg.effort,
    contextFiles: stable(state.contextFiles, msg.contextFiles),
    missingContext: stable(state.missingContext, msg.missingContext),
    sessionId: msg.sessionId,
  };
}

const NONE: Permission[] = [];

/** Chat state of a space, assembled from `chat.*`, `permission.request`, `agent.stats` and `error` messages. */
export function chatReducer(state: ChatState, msg: ChatAction): ChatState {
  switch (msg.type) {
    case 'chat.history':
      return {
        ...withSession(state, msg),
        log: {
          events: msg.events,
          earlier: msg.earlier ?? 0,
          conversation: state.log.conversation + 1,
        },
        permissions: NONE, // the server re-sends pending requests after the history
      };
    case 'chat.event':
      return { ...state, log: append(state.log, msg.event) };
    case 'chat.status': {
      const next = withSession(state, msg);
      // idle means the server settled any open request (interrupt, reset, other tab)
      return msg.status === 'idle' && next.permissions.length
        ? { ...next, permissions: NONE }
        : next;
    }
    case 'agent.stats':
      return {
        ...state,
        stats: { master: msg.master, current: msg.current, tasks: msg.tasks },
      };
    case 'permission.request':
      return { ...state, permissions: [...state.permissions, msg] };
    case 'permission.answered':
      return {
        ...state,
        permissions: state.permissions.filter(
          (p) => p.requestId !== msg.requestId,
        ),
      };
    case 'error':
      return {
        ...state,
        log: append(state.log, { kind: 'error', message: msg.message }),
      };
    default:
      return state;
  }
}
