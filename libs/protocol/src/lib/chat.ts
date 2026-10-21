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
  | { kind: 'commit'; hash: string; files: number; message: string }
  | { kind: 'error'; message: string };

export type ChatStatus = 'idle' | 'running';

/** Permission modes the UI offers; `bypassPermissions` is deliberately absent. */
export const CHAT_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'dontAsk',
] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

/** Models the chat can use (first = default, the master model); value -> short label. */
export const CHAT_MODELS = {
  'claude-opus-5-5': 'Opus 5.5',
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-haiku-5-5': 'Haiku 5.5',
  'claude-fable-5-1': 'Fable 5.1',
} as const;
export type ChatModel = keyof typeof CHAT_MODELS;
export const CHAT_MODEL_IDS = Object.keys(CHAT_MODELS) as [
  ChatModel,
  ...ChatModel[],
];

export type AgentTask = {
  id: string;
  description: string;
  subagentType?: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  tokens: number;
  toolUses: number;
  lastTool?: string;
};

export type ContextUsage = {
  tokens: number;
  /** context window the usage is measured against (the auto-compact window when one is set) */
  max: number;
  /** tokens / max, 0-100+ */
  percent: number;
  /** auto-compact threshold (window minus the compaction reserve); null = auto-compact off */
  limit: number | null;
};
