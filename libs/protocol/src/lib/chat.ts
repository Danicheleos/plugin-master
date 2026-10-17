// Normalized chat events: the UI never sees the shape of SDK messages.
export type ChatEvent =
  | { kind: 'user'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown }
  | {
      kind: 'tool_result';
      toolUseId: string;
      isError: boolean;
      preview: string;
    }
  | { kind: 'result'; isError: boolean; costUsd?: number; durationMs?: number }
  | { kind: 'error'; message: string };

export type ChatStatus = 'idle' | 'running';
