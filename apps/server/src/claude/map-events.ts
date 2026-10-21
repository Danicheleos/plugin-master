import type {
  SDKMessage,
  SessionMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentTask, ChatEvent } from '@pm/protocol';

const PREVIEW_CHARS = 500;

type Block = { type?: string; [k: string]: unknown };

const blocksOf = (content: unknown): Block[] =>
  Array.isArray(content) ? (content as Block[]) : [];

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  return blocksOf(content)
    .map((b) => (b.type === 'text' ? String(b.text ?? '') : ''))
    .join('');
}

/** The only place that knows the shape of SDK messages. */
export function mapSdkMessage(m: SDKMessage): ChatEvent[] {
  if (m.type === 'assistant') {
    return blocksOf(m.message.content).flatMap((b): ChatEvent[] => {
      if (b.type === 'text') return [{ kind: 'text', text: String(b.text) }];
      if (b.type === 'tool_use')
        return [
          {
            kind: 'tool_use',
            id: String(b.id),
            name: String(b.name),
            input: b.input,
          },
        ];
      return [];
    });
  }
  if (m.type === 'user') {
    return blocksOf(m.message.content).flatMap((b): ChatEvent[] =>
      b.type === 'tool_result'
        ? [
            {
              kind: 'tool_result',
              toolUseId: String(b.tool_use_id),
              isError: b.is_error === true,
              preview: textOf(b.content).slice(0, PREVIEW_CHARS),
            },
          ]
        : [],
    );
  }
  if (m.type === 'result') {
    return [
      {
        kind: 'result',
        isError: m.is_error,
        costUsd: m.total_cost_usd,
        durationMs: m.duration_ms,
      },
    ];
  }
  return [];
}

/** Maps a stored transcript message (API message shape) to events; subagent internals are skipped. */
export function mapSessionMessage(m: SessionMessage): ChatEvent[] {
  if (m.parent_tool_use_id || m.parent_agent_id) return [];
  if (m.type === 'assistant')
    return mapSdkMessage({
      type: 'assistant',
      message: m.message,
    } as SDKMessage);
  if (m.type !== 'user') return [];
  const text = textOf((m.message as { content?: unknown })?.content);
  return [
    ...(text ? [{ kind: 'user', text } as const] : []),
    ...mapSdkMessage({ type: 'user', message: m.message } as SDKMessage),
  ];
}

export type TaskUpdate = Partial<AgentTask> & Pick<AgentTask, 'id'>;

/** Subagent/background task lifecycle messages as a partial update of the task; undefined for other messages. */
export function mapTaskMessage(m: SDKMessage): TaskUpdate | undefined {
  if (m.type !== 'system') return undefined;
  if (m.subtype === 'task_started')
    return {
      id: m.task_id,
      description: m.description,
      ...(m.subagent_type && { subagentType: m.subagent_type }),
      status: 'running',
      tokens: 0,
      toolUses: 0,
    };
  if (m.subtype === 'task_progress')
    return {
      id: m.task_id,
      description: m.description,
      ...(m.subagent_type && { subagentType: m.subagent_type }),
      tokens: m.usage.total_tokens,
      toolUses: m.usage.tool_uses,
      ...(m.last_tool_name && { lastTool: m.last_tool_name }),
    };
  if (m.subtype === 'task_notification')
    return {
      id: m.task_id,
      status: m.status,
      ...(m.usage && {
        tokens: m.usage.total_tokens,
        toolUses: m.usage.tool_uses,
      }),
    };
  return undefined;
}

const SUMMARY_CHARS = 80;

/** A short "Tool: detail" line for a tool call, e.g. `Edit: src/a.ts` or `Bash: ls -la`. */
export function describeToolUse(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const detail = [
    i.file_path,
    i.path,
    i.command,
    i.pattern,
    i.description,
    i.prompt,
  ].find((v): v is string => typeof v === 'string' && v !== '');
  return detail
    ? `${name}: ${detail.replaceAll(/\s+/g, ' ').slice(0, SUMMARY_CHARS)}`
    : name;
}
