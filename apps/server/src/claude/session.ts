import {
  query,
  type CanUseTool,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { AsyncQueue } from '../lib/async-queue';

export type SessionOptions = {
  cwd: string;
  appendSystemPrompt: string;
  canUseTool: CanUseTool;
  onMessage: (m: SDKMessage) => void;
  onError: (e: unknown) => void;
};

/** The surface the session manager needs; tests substitute a fake. */
export type Session = {
  send(text: string): void;
  interrupt(): Promise<void>;
  close(): void;
};
export type SessionFactory = (o: SessionOptions) => Session;

/** One live SDK session (streaming input mode); auth comes from the environment. */
export class ClaudeSession implements Session {
  private input = new AsyncQueue<SDKUserMessage>();
  private q: Query;
  private closed = false;

  constructor(o: SessionOptions) {
    this.q = query({
      prompt: this.input,
      options: {
        cwd: o.cwd,
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: o.appendSystemPrompt,
        },
        settingSources: ['project'],
        // project settings must not widen the default (ask via canUseTool)
        permissionMode: 'default',
        canUseTool: o.canUseTool,
      },
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

  close(): void {
    this.closed = true;
    this.input.end();
    this.q.close();
  }

  private async pump(o: SessionOptions): Promise<void> {
    try {
      for await (const m of this.q) o.onMessage(m);
      if (!this.closed) throw new Error('The Claude session ended unexpectedly');
    } catch (e) {
      if (!this.closed) o.onError(e);
    }
  }
}

export const createClaudeSession: SessionFactory = (o) => new ClaudeSession(o);
