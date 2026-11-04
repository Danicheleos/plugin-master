import {
  getSessionMessages,
  listSessions,
} from '@anthropic-ai/claude-agent-sdk';
import type { ChatEvent, ProjectSession, SessionInfo } from '@pm/protocol';
import { basename } from 'node:path';
import { mapSessionMessage } from './map-events';

/** Past Claude sessions of a directory; tests substitute a fake. */
export type History = {
  list(dir: string): Promise<SessionInfo[]>;
  events(dir: string, sessionId: string): Promise<ChatEvent[]>;
  /** Sessions of every project under `~/.claude/projects`, newest first. */
  all(): Promise<ProjectSession[]>;
};

export const sdkHistory: History = {
  async list(dir) {
    const all = await listSessions({ dir });
    return all
      .map((s) => ({
        id: s.sessionId,
        title: s.customTitle ?? s.summary ?? s.firstPrompt ?? s.sessionId,
        lastModified: s.lastModified,
      }))
      .sort((a, b) => b.lastModified - a.lastModified);
  },
  async events(dir, sessionId) {
    const msgs = await getSessionMessages(sessionId, { dir });
    return msgs.flatMap(mapSessionMessage);
  },
  async all() {
    return (await listSessions())
      .map((s) => ({
        id: s.sessionId,
        title: s.customTitle ?? s.summary ?? s.firstPrompt ?? s.sessionId,
        lastModified: s.lastModified,
        cwd: s.cwd ?? '',
        project: s.cwd ? basename(s.cwd) || s.cwd : 'unknown',
      }))
      .sort((a, b) => b.lastModified - a.lastModified);
  },
};
