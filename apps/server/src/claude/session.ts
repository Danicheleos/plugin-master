import {
  query,
  type Options,
  type McpSdkServerConfigWithInstance,
  type CanUseTool,
  type Query,
  type SDKControlGetContextUsageResponse,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { ChatMode, ChatModel, ContextUsage } from '@pm/protocol';
import { AsyncQueue } from '../lib/async-queue';
import { MASTER_HOOKS } from './master-hook';

export type SessionOptions = {
  cwd: string;
  appendSystemPrompt: string;
  mode: ChatMode;
  model: ChatModel;
  /** Also load ~/.claude (and local) settings; default: project settings only. */
  userSettings?: boolean;
  /** SDK session id to continue */
  resume?: string;
  canUseTool: CanUseTool;
  /** In-process MCP servers and the tools of them that are allowed without asking. */
  mcpServers?: Record<string, McpSdkServerConfigWithInstance>;
  allowedTools?: string[];
  onMessage: (m: SDKMessage) => void;
  onError: (e: unknown) => void;
};

/** The surface the session manager needs; tests substitute a fake. */
export type Session = {
  send(text: string): void;
  interrupt(): Promise<void>;
  setMode(mode: ChatMode): Promise<void>;
  setModel(model: ChatModel): Promise<void>;
  /** Context window use of the conversation; null when unknown. */
  contextUsage(): Promise<ContextUsage | null>;
  close(): void;
};
export type SessionFactory = (o: SessionOptions) => Session;

/** Model of the master (chat) session. */
export const MASTER_MODEL = 'claude-opus-5-5';
/**
 * Auto-compact window of the master session in tokens (same as `/autocompact 300k`). Passed as the
 * CLI env var `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, which wins over the `autoCompactWindow` setting.
 */
const MASTER_AUTO_COMPACT_WINDOW = 300_000;
/**
 * Model of every subagent the master starts. `CLAUDE_CODE_SUBAGENT_MODEL` sets it, and
 * `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` makes the CLI ignore the Agent tool's `model` input and the
 * `model` of agent definitions, so it always applies.
 */
export const SUBAGENT_MODEL = 'claude-sonnet-5-5';

/**
 * `rawMaxTokens` is the resolved auto-compact window (300k under `MASTER_AUTO_COMPACT_WINDOW`; the
 * model's own max is not reported then); `autoCompactThreshold` is where compaction fires.
 */
export function toContextUsage(
  u: Pick<
    SDKControlGetContextUsageResponse,
    | 'totalTokens'
    | 'rawMaxTokens'
    | 'percentage'
    | 'autoCompactThreshold'
    | 'isAutoCompactEnabled'
  >,
): ContextUsage {
  return {
    tokens: u.totalTokens,
    max: u.rawMaxTokens,
    percent: u.percentage,
    limit: u.isAutoCompactEnabled ? (u.autoCompactThreshold ?? null) : null,
  };
}

/** SDK `query()` options of a master session. */
export function sessionQueryOptions(
  o: SessionOptions,
  base: NodeJS.ProcessEnv = process.env,
): Options {
  return {
    cwd: o.cwd,
    resume: o.resume,
    model: o.model,
    // the SDK `env` option replaces the inherited env, so it is merged here
    env: {
      ...base,
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(MASTER_AUTO_COMPACT_WINDOW),
      CLAUDE_CODE_SUBAGENT_MODEL: SUBAGENT_MODEL,
      CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1',
    },
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: o.appendSystemPrompt,
    },
    settingSources: o.userSettings ? ['user', 'project', 'local'] : ['project'],
    // always explicit: when omitted the CLI may start in 'auto'
    permissionMode: o.mode,
    canUseTool: o.canUseTool,
    mcpServers: o.mcpServers,
    allowedTools: o.allowedTools,
    hooks: MASTER_HOOKS,
  };
}

/** One live SDK session (streaming input mode); auth comes from the environment. */
class ClaudeSession implements Session {
  private input = new AsyncQueue<SDKUserMessage>();
  private q: Query;
  private closed = false;

  constructor(o: SessionOptions) {
    this.q = query({
      prompt: this.input,
      options: sessionQueryOptions(o),
    });
    void this.pump(o);
  }

  send(text: string): void {
    this.input.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    });
  }

  async interrupt(): Promise<void> {
    await this.q.interrupt();
  }

  async setMode(mode: ChatMode): Promise<void> {
    await this.q.setPermissionMode(mode);
  }

  async setModel(model: ChatModel): Promise<void> {
    await this.q.setModel(model);
  }

  async contextUsage(): Promise<ContextUsage | null> {
    return toContextUsage(await this.q.getContextUsage({ detail: 'summary' }));
  }

  close(): void {
    this.closed = true;
    this.input.end();
    this.q.close();
  }

  private async pump(o: SessionOptions): Promise<void> {
    try {
      for await (const m of this.q) o.onMessage(m);
      if (!this.closed)
        throw new Error('The Claude session ended unexpectedly');
    } catch (e) {
      if (!this.closed) o.onError(e);
    }
  }
}

export const createClaudeSession: SessionFactory = (o) => new ClaudeSession(o);
