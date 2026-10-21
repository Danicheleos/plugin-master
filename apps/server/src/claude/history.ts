import {
  getSessionMessages,
  listSessions,
} from '@anthropic-ai/claude-agent-sdk';
import type { ChatEvent, ProjectSession, SessionInfo, Trace } from '@pm/protocol';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { parseTrace } from '../evals/trace';
import { mapSessionMessage } from './map-events';

/** Past Claude sessions of a directory; tests substitute a fake. */
export type History = {
  list(dir: string): Promise<SessionInfo[]>;
  events(dir: string, sessionId: string): Promise<ChatEvent[]>;
  /** Sessions of every project under `~/.claude/projects`, newest first. */
  all(): Promise<ProjectSession[]>;
  /** Flow/trace of any session listed by `all()` (looked up by id, never by a client path). */
  trace(sessionId: string): Promise<Trace | undefined>;
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
  async trace(sessionId) {
    // the raw transcript, not `getSessionMessages`: only the file has attachments and the system prompt snapshot
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return undefined;
    const known = (await listSessions()).some((x) => x.sessionId === sessionId);
    if (!known) return undefined;
    const base = join(homedir(), '.claude', 'projects');
    for (const d of await readdir(base).catch(() => [] as string[])) {
      const file = join(base, d, `${sessionId}.jsonl`);
      if (await stat(file).then((f) => f.isFile(), () => false)) return parseTrace(await readFile(file, 'utf8'));
    }
    return undefined;
  },
};
