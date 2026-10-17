import { useState, type KeyboardEvent } from 'react';
import { Button, Group, Text, Textarea } from '@mantine/core';
import { ContextSummary } from '../context/ContextSummary';
import { MessageList } from './MessageList';
import { PermissionPrompt } from './PermissionPrompt';
import { useChat } from './hooks';
import styles from './chat.module.scss';

export function ChatPanel({ spaceId }: { spaceId: string }) {
  const chat = useChat(spaceId);
  const [text, setText] = useState('');

  const submit = () => {
    if (!text.trim() || chat.status === 'running') return;
    chat.send(text);
    setText('');
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.panel}>
      <Group className={styles.header} justify="space-between">
        <Text fw={600}>Claude</Text>
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
      <Group className={styles.input} wrap="nowrap" align="flex-end">
        <Textarea
          flex={1}
          value={text}
          rows={3}
          placeholder="Message (Enter to send, Shift+Enter for a new line)"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {chat.status === 'running' ? (
          <Button variant="default" onClick={chat.interrupt}>
            Stop
          </Button>
        ) : (
          <Button onClick={submit} disabled={!text.trim()}>
            Send
          </Button>
        )}
      </Group>
      {chat.permission && (
        <PermissionPrompt
          request={chat.permission}
          onReply={(allow) => chat.reply(chat.permission!.requestId, allow)}
        />
      )}
    </div>
  );
}
