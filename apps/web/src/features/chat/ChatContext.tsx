import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { ChatStatus } from '@pm/protocol';
import { useLatestCallback } from '../../shared/ui/useLatestCallback';
import { PermissionPrompt } from './PermissionPrompt';
import { playFinished } from '../sound';
import { useChat, type ChatActions } from './hooks';
import type { AgentStats, ChatLog, ChatSettings } from './reducer';

/*
 * The chat state is split over several contexts so a consumer re-renders only when its slice
 * changes: a widget that needs the status does not re-render on every `chat.event` or `agent.stats`.
 * Each value is a primitive or memoized per slice; the actions are created once per space.
 */
const StatusContext = createContext<ChatStatus | null>(null);
const SettingsContext = createContext<ChatSettings | null>(null);
const LogContext = createContext<ChatLog | null>(null);
const StatsContext = createContext<AgentStats | null>(null);
const ActionsContext = createContext<ChatActions | null>(null);

/**
 * The single `useChat` of a workspace (a second instance would not get `chat.history`). Always
 * mounted, so chat state outlives the chat widget; only consumers of a changed slice re-render.
 */
export function ChatProvider({
  spaceId,
  children,
}: {
  spaceId: string;
  children: ReactNode;
}) {
  const { state, actions } = useChat(spaceId);
  const {
    status,
    mode,
    model,
    effort,
    sessionId,
    contextFiles,
    missingContext,
  } = state;
  const settings = useMemo(
    () => ({ mode, model, effort, sessionId, contextFiles, missingContext }),
    [mode, model, effort, sessionId, contextFiles, missingContext],
  );
  // a turn that ends (running -> idle) plays the chosen sound; mounting while idle does not
  const was = useRef(status);
  useEffect(() => {
    if (was.current === 'running' && status === 'idle') playFinished();
    was.current = status;
  }, [status]);
  const permission = state.permissions[0];
  return (
    <ActionsContext.Provider value={actions}>
      <StatusContext.Provider value={status}>
        <SettingsContext.Provider value={settings}>
          <LogContext.Provider value={state.log}>
            <StatsContext.Provider value={state.stats}>
              {children}
              {/* the single prompt: requests (also of experiment executors) show without a chat widget */}
              {permission && (
                <PermissionPrompt
                  request={permission}
                  onReply={(allow) =>
                    actions.reply(permission.requestId, allow)
                  }
                />
              )}
            </StatsContext.Provider>
          </LogContext.Provider>
        </SettingsContext.Provider>
      </StatusContext.Provider>
    </ActionsContext.Provider>
  );
}

function required<T>(value: T | null, hook: string): T {
  if (value === null) throw new Error(`${hook} outside ChatProvider`);
  return value;
}

/** `running` while a turn is in progress. */
export const useChatStatus = () =>
  required(useContext(StatusContext), 'useChatStatus');
/** Mode, model, effort, session id and context files. */
export const useChatSettings = () =>
  required(useContext(SettingsContext), 'useChatSettings');
/** The windowed events; changes with every `chat.event`. */
export const useChatLog = () => required(useContext(LogContext), 'useChatLog');
/** Agent usage and tasks; changes with every `agent.stats`. */
export const useChatStats = () =>
  required(useContext(StatsContext), 'useChatStats');
/** send, interrupt, resume, reset, setMode/Model/Effort, reply; the object never changes while the space is open. */
export const useChatActions = () =>
  required(useContext(ActionsContext), 'useChatActions');

/**
 * Of the live chat of `runId` (the open session of the surrounding `ChatProvider`): a number that
 * grows with its events and whether a turn runs. Zero/false when not live or outside a provider.
 */
export function useChatLiveRun(runId: string): {
  tick: number;
  running: boolean;
} {
  const settings = useContext(SettingsContext);
  const log = useContext(LogContext);
  const status = useContext(StatusContext);
  const live = !!settings && !!log && settings.sessionId === runId;
  return {
    tick: live ? log.earlier + log.events.length : 0,
    running: live && status === 'running',
  };
}

/** Runs `cb` on mount and whenever the chat turn goes idle (files, commits and runs may have changed). Re-renders only on a status change. */
export function useOnChatIdle(cb: () => void) {
  const status = useChatStatus();
  const run = useLatestCallback(cb);
  useEffect(() => {
    if (status === 'idle') run();
  }, [status, run]);
}
