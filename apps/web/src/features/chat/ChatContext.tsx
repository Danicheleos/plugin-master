import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { PermissionPrompt } from './PermissionPrompt';
import { playFinished } from '../sound/sounds';
import { useChat } from './hooks';

const ChatContext = createContext<ReturnType<typeof useChat> | null>(null);

/**
 * The single `useChat` of a workspace (a second instance would not get `chat.history`). Always
 * mounted, so chat state outlives the chat widget; only consumers re-render on chat events.
 */
export function ChatProvider({
  spaceId,
  children,
}: {
  spaceId: string;
  children: ReactNode;
}) {
  const chat = useChat(spaceId);
  // a turn that ends (running -> idle) plays the chosen sound; mounting while idle does not
  const was = useRef(chat.status);
  useEffect(() => {
    if (was.current === 'running' && chat.status === 'idle') playFinished();
    was.current = chat.status;
  }, [chat.status]);
  return (
    <ChatContext.Provider value={chat}>
      {children}
      {/* the single prompt: requests (also of experiment executors) show without a chat widget */}
      {chat.permission && (
        <PermissionPrompt
          request={chat.permission}
          onReply={(allow) => chat.reply(chat.permission!.requestId, allow)}
        />
      )}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  const chat = useContext(ChatContext);
  if (!chat) throw new Error('useChatContext outside ChatProvider');
  return chat;
}

/** Runs `cb` on mount and whenever the chat turn goes idle (files, commits and runs may have changed). */
export function useOnChatIdle(cb: () => void) {
  const { status } = useChatContext();
  const latest = useRef(cb);
  latest.current = cb;
  useEffect(() => {
    if (status === 'idle') latest.current();
  }, [status]);
}
