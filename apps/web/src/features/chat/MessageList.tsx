import { useEffect, useRef, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import { Button, Code, Collapse, Paper, Text, Typography } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { ChatEvent } from '@pm/protocol';
import styles from './chat.module.scss';

function Tool({
  label,
  color,
  children,
}: {
  label: string;
  color: string;
  children: ReactNode;
}) {
  const [open, { toggle }] = useDisclosure(false);
  return (
    <div>
      <Button variant="subtle" color={color} size="compact-xs" onClick={toggle}>
        {label}
      </Button>
      <Collapse expanded={open}>
        <Code block fz="xs">
          {children}
        </Code>
      </Collapse>
    </div>
  );
}

function Item({ e }: { e: ChatEvent }) {
  switch (e.kind) {
    case 'user':
      return (
        <Paper bg="var(--mantine-color-default-hover)" px="sm">
          <Typography>
            <Markdown>{e.text}</Markdown>
          </Typography>
        </Paper>
      );
    case 'text':
      return (
        <Typography>
          <Markdown>{e.text}</Markdown>
        </Typography>
      );
    case 'tool_use':
      return (
        <Tool label={`🔧 ${e.name}`} color="gray">
          {JSON.stringify(e.input, null, 2)}
        </Tool>
      );
    case 'tool_result':
      return (
        <Tool
          label={e.isError ? 'Tool error' : 'Result'}
          color={e.isError ? 'red' : 'gray'}
        >
          {e.preview}
        </Tool>
      );
    case 'result':
      return (
        <Text size="xs" c="dimmed" my="xs">
          {e.isError ? 'Finished with an error' : 'Done'}
          {e.durationMs !== undefined &&
            ` · ${(e.durationMs / 1000).toFixed(1)} s`}
          {e.costUsd !== undefined && ` · $${e.costUsd.toFixed(4)}`}
        </Text>
      );
    case 'error':
      return <Text c="red">{e.message}</Text>;
  }
}

export function MessageList({ events }: { events: ChatEvent[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [events]);
  return (
    <div className={styles.list}>
      {events.map((e, i) => (
        <Item key={i} e={e} />
      ))}
      <div ref={end} />
    </div>
  );
}
