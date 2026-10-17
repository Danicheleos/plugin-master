import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ChatEvent } from '@pm/protocol';

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
