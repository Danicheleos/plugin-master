import { memo, useState, type KeyboardEvent } from 'react';
import { Button, Group, Select, Stack, Textarea } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import type { ChatModel } from '@pm/protocol';
import { ContextSummary } from '../context/ContextSummary';
import { MessageList } from './MessageList';
import { ModelSelect } from './ModelSelect';
import { ModeSelect } from './ModeSelect';
import { useChatContext } from './ChatContext';
import { useSessions } from './hooks';
import styles from './chat.module.scss';

/** Owns the draft text, so typing re-renders only this input, not the message list; memo + stable callbacks keep chat events from re-rendering it. */
const ChatInput = memo(function ChatInput({
  running,
  onSend,
  onStop,
  model,
  onModel,
}: {
  running: boolean;
  model: ChatModel | null;
  onModel: (m: ChatModel) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const touch = useMediaQuery('(pointer: coarse)'); // phones and tablets: Enter is a new line, Send button submits

  const submit = () => {
    if (!text.trim() || running) return;
    onSend(text);
    setText('');
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !touch && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Group className={styles.input} wrap="nowrap" align="flex-end">
      <Textarea
        flex={1}
        value={text}
        rows={3}
        placeholder={touch ? 'Message' : 'Message (Enter to send, Shift+Enter for a new line)'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <Stack gap="xs">
        <ModelSelect model={model} onChange={onModel} />
        {running ? (
          <Button variant="default" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button onClick={submit} disabled={!text.trim()}>
            Send
          </Button>
        )}
      </Stack>
    </Group>
  );
});

export function ChatPanel({ spaceId }: { spaceId: string }) {
  const chat = useChatContext();
  const sessions = useSessions(spaceId, chat.sessionId, chat.status);

  return (
    <div className={styles.panel}>
      <Group className={styles.header} justify="space-between">
        <Select
          size="xs"
          flex={1}
          aria-label="Session"
          placeholder="New session"
          allowDeselect={false}
          data={(sessions.data ?? []).map((s) => ({
            value: s.id,
            label: s.title,
          }))}
          value={chat.sessionId}
          onChange={(id) => id && id !== chat.sessionId && chat.resume(id)}
        />
        <ModeSelect mode={chat.mode} onChange={chat.setMode} />
        <Button variant="default" size="compact-sm" onClick={chat.reset}>
          New session
        </Button>
      </Group>
      <ContextSummary
        spaceId={spaceId}
        contextFiles={chat.contextFiles}
        missingContext={chat.missingContext}
        onNewSession={chat.reset}
      />
      <MessageList events={chat.events} />
      <ChatInput
        running={chat.status === 'running'}
        onSend={chat.send}
        onStop={chat.interrupt}
        model={chat.model}
        onModel={chat.setModel}
      />
    </div>
  );
}
