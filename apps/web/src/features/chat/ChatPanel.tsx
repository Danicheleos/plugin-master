import { memo, useCallback, useState, type KeyboardEvent } from 'react';
import {
  ActionIcon,
  Button,
  Collapse,
  Group,
  Stack,
  Textarea,
} from '@mantine/core';
import { useElementSize, useMediaQuery } from '@mantine/hooks';
import { CHAT_MODELS } from '@pm/protocol';
import { ContextSummary } from '../context';
import { MessageList } from './MessageList';
import { EffortSelect, effortLabel } from './EffortSelect';
import { ModelSelect } from './ModelSelect';
import { MODE_LABELS, ModeSelect } from './ModeSelect';
import {
  useChatActions,
  useChatLog,
  useChatSettings,
  useChatStatus,
} from './ChatContext';
import { RunningAgents } from './RunningAgents';
import { SessionSelect } from './SessionSelect';
import styles from './chat.module.scss';
import { usePersistentFlag } from '../../shared/storage';

const OPEN_KEY = 'pm.chat.controlsOpen';

/** Owns the draft text, so typing re-renders only this input, not the message list; memo + stable callbacks keep chat events from re-rendering it. */
const ChatInput = memo(function ChatInput({
  expanded,
  onExpanded,
  maxHeight,
}: {
  /** the textarea fills the panel; collapses after sending */
  expanded: boolean;
  onExpanded: (v: boolean) => void;
  /** autosize cap in px (half the panel); then the textarea scrolls */
  maxHeight: number;
}) {
  const running = useChatStatus() === 'running';
  const { send: onSend, interrupt: onStop } = useChatActions();
  const [text, setText] = useState('');
  const touch = useMediaQuery('(pointer: coarse)'); // phones and tablets: Enter is a new line, Send button submits

  const submit = () => {
    if (!text.trim() || running) return;
    onSend(text);
    setText('');
    onExpanded(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (
      e.key === 'Enter' &&
      !touch &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Group
      className={styles.input}
      wrap="nowrap"
      align={expanded ? 'stretch' : 'flex-end'}
    >
      <Textarea
        flex={1}
        autosize={!expanded}
        minRows={2}
        styles={{
          root: expanded ? { height: '100%' } : undefined,
          wrapper: expanded ? { height: '100%' } : undefined,
          input: expanded
            ? { height: '100%' }
            : { maxHeight: maxHeight || undefined, overflowY: 'auto' },
        }}
        value={text}
        placeholder={
          touch
            ? 'Message'
            : 'Message (Enter to send, Shift+Enter for a new line)'
        }
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <Stack gap="xs" justify="flex-end">
        <ActionIcon
          variant="default"
          size="lg"
          aria-label={expanded ? 'Collapse input' : 'Expand input'}
          aria-pressed={expanded}
          onClick={() => onExpanded(!expanded)}
        >
          {expanded ? '⤡' : '⤢'}
        </ActionIcon>
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

/** The windowed events; the only part that re-renders per `chat.event`. */
function ChatLog({ spaceId }: { spaceId: string }) {
  const { events, earlier, conversation } = useChatLog();
  const { sessionId } = useChatSettings();
  return (
    <MessageList
      events={events}
      earlier={earlier}
      conversation={conversation}
      spaceId={spaceId}
      sessionId={sessionId}
    />
  );
}

export function ChatPanel({ spaceId }: { spaceId: string }) {
  const chat = useChatSettings();
  const { reset, setMode, setModel, setEffort } = useChatActions();
  const [open, setOpen] = usePersistentFlag(OPEN_KEY);
  const [expanded, setExpanded] = useState(false);
  const { ref, height } = useElementSize<HTMLDivElement>();
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  const summary = [
    chat.model ? CHAT_MODELS[chat.model] : '…',
    MODE_LABELS[chat.mode],
    effortLabel(chat.effort),
  ].join(' · ');

  return (
    <div
      ref={ref}
      className={`${styles.panel} ${expanded ? styles.panelExpanded : ''}`}
    >
      <div className={styles.sessionToggle}>
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          aria-expanded={open}
          onClick={toggle}
        >
          Session {open ? '▾' : '▸'} · {summary}
        </Button>
      </div>
      <Collapse expanded={open}>
        <Group className={styles.controls} gap="xs">
          <SessionSelect spaceId={spaceId} />
          <Button variant="default" size="compact-sm" onClick={reset}>
            New session
          </Button>
          <ModeSelect mode={chat.mode} onChange={setMode} />
          <ModelSelect model={chat.model} onChange={setModel} />
          <EffortSelect effort={chat.effort} onChange={setEffort} />
          <ContextSummary
            spaceId={spaceId}
            contextFiles={chat.contextFiles}
            missingContext={chat.missingContext}
            onNewSession={reset}
          />
        </Group>
      </Collapse>
      <ChatLog spaceId={spaceId} />
      <RunningAgents spaceId={spaceId} />
      <ChatInput
        expanded={expanded}
        onExpanded={setExpanded}
        maxHeight={Math.round(height / 2)}
      />
    </div>
  );
}
