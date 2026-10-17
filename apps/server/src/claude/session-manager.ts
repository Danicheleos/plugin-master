import type { ChatEvent, ChatStatus } from '@pm/protocol';
import { AppError } from '../lib/errors';
import { buildContext } from '../context/build-context';
import type { Registry } from '../spaces/registry';
import { createSpacesService } from '../spaces/service';
import type { Hub } from '../ws/hub';
import { createPermissions } from './permissions';
import { mapSdkMessage } from './map-events';
import {
  createClaudeSession,
  type Session,
  type SessionFactory,
} from './session';

type State = {
  session?: Session;
  /** A session being created; claimed synchronously so concurrent sends share it. */
  opening?: Promise<Session | undefined>;
  /** Bumped by reset/close so a creation in flight knows it was cancelled. */
  generation: number;
  /** Context files the current session started with (reported in chat.history/chat.status). */
  contextFiles: string[] | null;
  missingContext: string[];
  /** Turns sent but not yet finished; status is idle only at 0. */
  inflight: number;
  status: ChatStatus;
  events: ChatEvent[];
};

/** Chat state per space (in memory only) and the hub handlers that drive Claude sessions. */
export function createSessionManager(
  hub: Hub,
  registry: Registry,
  newSession: SessionFactory = createClaudeSession,
) {
  const spaces = createSpacesService(registry);
  const states = new Map<string, State>();
  const permissions = createPermissions((id, m) => hub.broadcast(id, m));
  const stateOf = (id: string): State => {
    let s = states.get(id);
    if (!s)
      states.set(
        id,
        (s = {
          status: 'idle',
          events: [],
          generation: 0,
          contextFiles: null,
          missingContext: [],
          inflight: 0,
        }),
      );
    return s;
  };

  function emit(spaceId: string, ...events: ChatEvent[]) {
    stateOf(spaceId).events.push(...events);
    for (const event of events)
      hub.broadcast(spaceId, { type: 'chat.event', spaceId, event });
  }
  function setStatus(spaceId: string, status: ChatStatus) {
    const s = stateOf(spaceId);
    if (s.status === status) return;
    s.status = status;
    hub.broadcast(spaceId, {
      type: 'chat.status',
      spaceId,
      status,
      contextFiles: s.contextFiles,
      missingContext: s.missingContext,
    });
  }
  function drop(spaceId: string, session: Session) {
    session.close();
    const s = stateOf(spaceId);
    if (s.session === session) {
      s.session = undefined;
      s.contextFiles = null;
      s.missingContext = [];
    }
  }

  async function createSession(spaceId: string): Promise<Session | undefined> {
    const state = stateOf(spaceId);
    const generation = state.generation;
    const { path: root } = await registry.get(spaceId);
    // Fixed for the session's lifetime. A bad config or file throws: no session with partial context.
    let masterContext: string[];
    let append: string;
    let missing: string[];
    try {
      ({ masterContext } = await spaces.getConfig(spaceId));
      ({ text: append, missing } = await buildContext(root, masterContext));
    } catch (e) {
      throw new AppError(
        'CONTEXT_INVALID',
        `Cannot build the master context from .plugin-master/config.json: ${e instanceof Error ? e.message : String(e)}. Fix or remove the entry in "masterContext" (or unpin it in the file tree) and send again.`,
        400,
      );
    }
    if (state.generation !== generation) return undefined; // reset meanwhile
    const session: Session = newSession({
      cwd: root,
      appendSystemPrompt: append,
      canUseTool: permissions.canUseTool(spaceId),
      // callbacks of a replaced (reset/failed) session are ignored
      onMessage: (m) => {
        if (stateOf(spaceId).session !== session) return;
        const events = mapSdkMessage(m);
        emit(spaceId, ...events);
        if (events.some((e) => e.kind === 'result')) {
          const st = stateOf(spaceId);
          st.inflight = Math.max(0, st.inflight - 1);
          if (st.inflight === 0) setStatus(spaceId, 'idle');
        }
      },
      onError: (e) => {
        if (stateOf(spaceId).session !== session) return;
        drop(spaceId, session);
        stateOf(spaceId).inflight = 0;
        emit(spaceId, {
          kind: 'error',
          message: e instanceof Error ? e.message : String(e),
        });
        setStatus(spaceId, 'idle');
      },
    });
    state.session = session;
    state.contextFiles = masterContext;
    state.missingContext = missing;
    return session;
  }

  hub.on('chat.send', async ({ spaceId, text }) => {
    const s = stateOf(spaceId);
    const session =
      s.session ??
      (await (s.opening ??= createSession(spaceId).finally(
        () => (s.opening = undefined),
      )));
    if (!session) return;
    emit(spaceId, { kind: 'user', text });
    s.inflight++;
    setStatus(spaceId, 'running');
    session.send(text);
  });

  hub.on('chat.interrupt', async ({ spaceId }) => {
    await stateOf(spaceId).session?.interrupt();
  });

  hub.on('chat.reset', ({ spaceId }) => {
    const s = stateOf(spaceId);
    s.generation++;
    if (s.session) drop(spaceId, s.session);
    s.events = [];
    s.contextFiles = null;
    s.missingContext = [];
    s.inflight = 0;
    hub.broadcast(spaceId, {
      type: 'chat.history',
      spaceId,
      events: [],
      status: 'idle',
      contextFiles: null,
      missingContext: [],
    });
    setStatus(spaceId, 'idle');
  });

  hub.on('permission.reply', ({ requestId, allow }) =>
    permissions.reply(requestId, allow),
  );

  hub.onSubscribe((spaceId, client) => {
    const { events, status, contextFiles, missingContext } = stateOf(spaceId);
    client.send({
      type: 'chat.history',
      spaceId,
      events: [...events],
      status,
      contextFiles,
      missingContext,
    });
    permissions.pendingFor(spaceId).forEach((m) => client.send(m));
  });

  return {
    /** Closes every live session (server shutdown). */
    close: () =>
      states.forEach((s) => {
        s.generation++;
        s.session?.close();
      }),
  };
}
