import { useState } from 'react';
import { Text, UnstyledButton } from '@mantine/core';
import type { AgentTask } from '@pm/protocol';
import { tokens } from '../../shared/format';
import { LiveSubagentTraceModal } from './LiveTraceModals';
import { useChatSettings, useChatStats } from './ChatContext';
import styles from './chat.module.scss';

/** Who a task is: the Agent call's name, else its subagent type, else the SDK task type. */
const agentWho = (t: AgentTask) =>
  t.name ?? t.subagentType ?? t.taskType ?? 'agent';

/**
 * Agents running now (subagents and background tasks), one compact line each: who, its task, its
 * latest tool call and its usage; a subagent line opens that subagent's own trace. Hidden when none.
 * Subscribes to the stats itself, so a stats update re-renders only this.
 */
export function RunningAgents({ spaceId }: { spaceId: string }) {
  const { tasks } = useChatStats();
  const { sessionId } = useChatSettings();
  const [agent, setAgent] = useState<AgentTask | null>(null);
  const running = tasks.filter((t) => t.status === 'running');
  const onOpen = sessionId ? setAgent : undefined;
  return (
    <>
      {running.length > 0 && (
        <div className={styles.agents} aria-label="Running agents">
          {running.map((t) => {
            const who = agentWho(t);
            const line = (
              <Text size="xs" truncate title={t.description}>
                <Text span inherit fw={600}>
                  {who}
                </Text>
                {t.subagentType &&
                  t.subagentType !== who &&
                  ` (${t.subagentType})`}
                {t.description && ` · ${t.description}`}
                {(t.action ?? t.lastTool) && (
                  <Text span inherit c="dimmed">
                    {' · '}
                    {t.action ?? t.lastTool}
                  </Text>
                )}
                <Text span inherit c="dimmed">
                  {' · '}
                  {t.toolUses} tool{t.toolUses === 1 ? '' : 's'} ·{' '}
                  {tokens(t.tokens)} tokens
                </Text>
              </Text>
            );
            return t.toolUseId && onOpen ? (
              <UnstyledButton
                key={t.id}
                display="block"
                w="100%"
                aria-label={`Open the trace of ${who}`}
                onClick={() => onOpen(t)}
              >
                {line}
              </UnstyledButton>
            ) : (
              <div key={t.id}>{line}</div>
            );
          })}
        </div>
      )}
      {agent?.toolUseId && sessionId && (
        <LiveSubagentTraceModal
          spaceId={spaceId}
          runId={sessionId}
          toolUseId={agent.toolUseId}
          title={`Agent: ${agentWho(agent)} · ${agent.description}`}
          onClose={() => setAgent(null)}
        />
      )}
    </>
  );
}
