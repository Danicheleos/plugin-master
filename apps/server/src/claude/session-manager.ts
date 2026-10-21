import {
  CHAT_MODES,
  type AgentTask,
  type ChatEvent,
  type ChatMode,
  type ChatModel,
  type ChatStatus,
  type ContextUsage,
} from '@pm/protocol';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AppError } from '../lib/errors';
import { buildContext } from '../context/build-context';
import type { Registry } from '../spaces/registry';
import {
  createPlanMcpServer,
  PLAN_SERVER,
  PLAN_TOOL_NAMES,
} from '../plans/tools';
import { createPlansService } from '../plans/service';
import {
  createRecorder,
  type Recorder,
  type RunWriter,
} from '../runs/recorder';
import {
  EVAL_ALLOWED_TOOLS,
  EVAL_SERVER,
  createEvalMcpServer,
} from '../evals/tools';
import type { EvalRunner } from '../evals/runner';
import { createSpacesService } from '../spaces/service';
import type { Hub } from '../ws/hub';
import { commitTurn, snapshot, type Snapshot } from './auto-commit';
import { MASTER_PROMPT_FILE, loadMasterPrompt } from './master-prompt';
import { createPermissions } from './permissions';
import { sdkHistory, type History } from './history';
import { describeToolUse, mapSdkMessage, mapTaskMessage } from './map-events';
import {
  createClaudeSession,
  MASTER_MODEL,
  type Session,
  type SessionFactory,
} from './session';

type State = {
  session?: Session;
  /** Records the live session's raw messages to `.plugin-master/runs/`. */
  writer?: RunWriter;
  /** A session being created; claimed synchronously so concurrent sends share it. */
  opening?: Promise<Session | undefined>;
  /** Bumped by reset/close so a creation in flight knows it was cancelled. */
  generation: number;
  /** Context files the current session started with (reported in chat.history/chat.status). */
  contextFiles: string[] | null;
  missingContext: string[];
  /** SDK session id of the conversation; the next created session resumes it. */
  sessionId: string | null;
  /** Tail of the chat.send dispatch chain. */
  dispatch: Promise<void>;
  /** Sent turns awaiting their result, in order, with the dirty paths when each was sent (auto-commit); status is idle only when empty. */
  turns: { prompt: string; before: Snapshot | null }[];
  status: ChatStatus;
  /** Permission mode; survives New session/resume for the server's lifetime. */
  mode: ChatMode;
  /** Model; survives New session/resume for the server's lifetime. */
  model: ChatModel;
  events: ChatEvent[];
  /** Agent activity shown next to the chat; cleared with the session. */
  master: ContextUsage | null;
  current: string | null;
  tasks: Map<string, AgentTask>;
};

/** Chat state per space (in memory only) and the hub handlers that drive Claude sessions. */
export function createSessionManager(
  hub: Hub,
  registry: Registry,
  newSession: SessionFactory = createClaudeSession,
  history: History = sdkHistory,
  recorder: Recorder = createRecorder(),
  /** the app's eval runner: gives the master the `evals` MCP tools */
  evals?: { runner: EvalRunner; busy?: (spaceId: string) => boolean },
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
          mode: 'auto',
          model: MASTER_MODEL,
          events: [],
          generation: 0,
          contextFiles: null,
          missingContext: [],
          sessionId: null,
          dispatch: Promise.resolve(),
          turns: [],
          master: null,
          current: null,
          tasks: new Map(),
        }),
      );
    return s;
  };

  function emit(spaceId: string, ...events: ChatEvent[]) {
    stateOf(spaceId).events.push(...events);
    for (const event of events)
      hub.broadcast(spaceId, { type: 'chat.event', spaceId, event });
  }
  function broadcastStatus(spaceId: string) {
    const { status, mode, model, contextFiles, missingContext, sessionId } =
      stateOf(spaceId);
    hub.broadcast(spaceId, {
      type: 'chat.status',
      spaceId,
      status,
      mode,
      model,
      contextFiles,
      missingContext,
      sessionId,
    });
  }
  /** Sets one status field and broadcasts when it changed. */
  function setField<K extends 'status' | 'mode' | 'model'>(
    spaceId: string,
    key: K,
    value: State[K],
  ) {
    const s = stateOf(spaceId);
    if (s[key] === value) return;
    s[key] = value;
    broadcastStatus(spaceId);
  }
  const setStatus = (id: string, v: ChatStatus) => setField(id, 'status', v);
  const setModel = (id: string, v: ChatModel) => setField(id, 'model', v);
  const setMode = (id: string, v: ChatMode) => setField(id, 'mode', v);
  const statsMessage = (spaceId: string) => {
    const { master, current, tasks } = stateOf(spaceId);
    return {
      type: 'agent.stats' as const,
      spaceId,
      master,
      current,
      tasks: [...tasks.values()],
    };
  };
  const broadcastStats = (spaceId: string) =>
    hub.broadcast(spaceId, statsMessage(spaceId));
  function resetStats(spaceId: string) {
    const s = stateOf(spaceId);
    s.master = null;
    s.current = null;
    s.tasks.clear();
    broadcastStats(spaceId);
  }
  function drop(spaceId: string, session: Session) {
    session.close();
    const s = stateOf(spaceId);
    if (s.session === session) {
      s.session = undefined;
      s.contextFiles = null;
      s.missingContext = [];
      resetStats(spaceId);
    }
  }

  /** Updates the current action, subagent tasks and (after a turn) the context size, and broadcasts changes. */
  function trackActivity(
    spaceId: string,
    session: Session,
    m: SDKMessage,
    events: ChatEvent[],
  ) {
    const st = stateOf(spaceId);
    const task = mapTaskMessage(m);
    if (task) {
      const prev = st.tasks.get(task.id);
      st.tasks.set(task.id, {
        description: '',
        status: 'running',
        tokens: 0,
        toolUses: 0,
        ...prev,
        ...task,
      });
      return broadcastStats(spaceId);
    }
    const tool = [...events].reverse().find((e) => e.kind === 'tool_use');
    const ended = events.some((e) => e.kind === 'result');
    if (!tool && !ended) return;
    if (tool) st.current = describeToolUse(tool.name, tool.input);
    if (ended) st.current = null;
    broadcastStats(spaceId);
    if (ended)
      session.contextUsage().then(
        (usage) => {
          if (st.session !== session || !usage) return;
          st.master = usage;
          broadcastStats(spaceId);
        },
        () => undefined, // usage is informational
      );
  }

  /** Commits the turn's changes (if enabled) and reports it in the chat; never throws. */
  async function autoCommit(
    spaceId: string,
    root: string,
    turn: State['turns'][number],
    generation: number,
  ) {
    const s = stateOf(spaceId);
    const event = await commitTurn(root, turn.before, turn.prompt, s.sessionId);
    if (event?.kind === 'commit')
      hub.broadcast(spaceId, { type: 'git.changed', spaceId });
    if (event && s.generation === generation) emit(spaceId, event); // not into a replaced conversation
  }

  async function createSession(spaceId: string): Promise<Session | undefined> {
    const state = stateOf(spaceId);
    const generation = state.generation;
    const { path: root } = await registry.get(spaceId);
    // Fixed for the session's lifetime. A bad config or file throws: no session with partial context.
    let masterContext: string[];
    let userSettings: boolean;
    let append: string;
    let missing: string[];
    try {
      ({ masterContext, features: { userSettings } } = await spaces.getConfig(spaceId));
      ({ text: append, missing } = await buildContext(root, masterContext.filter((f) => f !== MASTER_PROMPT_FILE)));
      append = [await loadMasterPrompt(root), append].join('\n\n');
    } catch (e) {
      throw new AppError(
        'CONTEXT_INVALID',
        `Cannot build the master context from .plugin-master/config.json: ${e instanceof Error ? e.message : String(e)}. Fix or remove the entry in "masterContext" (or unpin it in the file tree) and send again.`,
        400,
      );
    }
    if (state.generation !== generation) return undefined; // reset meanwhile
    const writer = recorder.start(root, state.sessionId ?? undefined);
    const session: Session = newSession({
      cwd: root,
      appendSystemPrompt: append,
      mode: state.mode,
      model: state.model,
      userSettings,
      resume: state.sessionId ?? undefined,
      canUseTool: permissions.canUseTool(spaceId),
      mcpServers: {
        [PLAN_SERVER]: createPlanMcpServer(
          createPlansService(root, () =>
            hub.broadcast(spaceId, { type: 'plans.changed', spaceId }),
          ),
        ),
        ...(evals && {
          [EVAL_SERVER]: createEvalMcpServer(
            spaceId,
            root,
            evals.runner,
            evals.busy,
          ),
        }),
      },
      allowedTools: evals
        ? [...PLAN_TOOL_NAMES, ...EVAL_ALLOWED_TOOLS]
        : PLAN_TOOL_NAMES,
      // callbacks of a replaced (reset/failed) session are ignored
      onMessage: (m) => {
        if (stateOf(spaceId).session !== session) return;
        writer.message(m);
        const sid = (m as { session_id?: unknown }).session_id;
        if (typeof sid === 'string') stateOf(spaceId).sessionId = sid;
        // the CLI switches mode itself (e.g. after ExitPlanMode is approved)
        const reported = (m as { permissionMode?: unknown }).permissionMode;
        if (m.type === 'system' && CHAT_MODES.some((x) => x === reported))
          setMode(spaceId, reported as ChatMode);
        const events = mapSdkMessage(m);
        emit(spaceId, ...events);
        trackActivity(spaceId, session, m, events);
        if (events.some((e) => e.kind === 'result')) {
          const st = stateOf(spaceId);
          const turn = st.turns.shift();
          if (turn) void autoCommit(spaceId, root, turn, st.generation);
          if (st.turns.length === 0) setStatus(spaceId, 'idle');
        }
      },
      onError: (e) => {
        if (stateOf(spaceId).session !== session) return;
        drop(spaceId, session);
        stateOf(spaceId).turns = [];
        const message = e instanceof Error ? e.message : String(e);
        emit(spaceId, {
          kind: 'error',
          message: /\b143\b|SIGTERM/.test(message)
            ? `${message}. The Claude process was terminated, usually because the server restarted (\`pnpm dev\` rebuilds it when server code changes; use \`pnpm dev:self\` when the agent edits plugin-master itself). Pick the session in the selector to continue it.`
            : message,
        });
        setStatus(spaceId, 'idle');
      },
    });
    state.session = session;
    state.writer = writer;
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
    // Snapshot before the turn can touch anything; dispatches are chained to keep send order.
    const run = s.dispatch.then(async () => {
      const { path: root } = await registry.get(spaceId);
      const before = await snapshot(root);
      if (s.session !== session) return; // reset/error while snapshotting
      s.turns.push({ prompt: text, before });
      s.writer?.user(text);
      emit(spaceId, { kind: 'user', text });
      setStatus(spaceId, 'running');
      session.send(text);
    });
    s.dispatch = run.catch(() => undefined);
    await run;
  });

  hub.on('chat.interrupt', async ({ spaceId }) => {
    await stateOf(spaceId).session?.interrupt();
  });

  hub.on('chat.mode', async ({ spaceId, mode }) => {
    const s = stateOf(spaceId);
    const previous = s.mode;
    const session = s.session;
    setMode(spaceId, mode);
    try {
      await session?.setMode(mode);
    } catch (e) {
      // not if the session was replaced or the CLI switched mode meanwhile
      if (s.session === session && s.mode === mode) setMode(spaceId, previous);
      throw e;
    }
  });

  hub.on('chat.model', async ({ spaceId, model }) => {
    const s = stateOf(spaceId);
    const previous = s.model;
    const session = s.session;
    setModel(spaceId, model);
    try {
      await session?.setModel(model);
    } catch (e) {
      if (s.session === session && s.model === model)
        setModel(spaceId, previous);
      throw e;
    }
  });

  /** Drops the live session and replaces the conversation shown (and resumed next) for the space. */
  function replaceConversation(
    spaceId: string,
    events: ChatEvent[],
    sessionId: string | null,
  ) {
    const s = stateOf(spaceId);
    s.generation++;
    if (s.session) drop(spaceId, s.session);
    s.events = events;
    s.sessionId = sessionId;
    s.contextFiles = null;
    s.missingContext = [];
    s.turns = [];
    resetStats(spaceId);
    hub.broadcast(spaceId, {
      type: 'chat.history',
      spaceId,
      events: [...events],
      status: 'idle',
      mode: s.mode,
      model: s.model,
      contextFiles: null,
      missingContext: [],
      sessionId,
    });
    setStatus(spaceId, 'idle');
  }

  hub.on('chat.reset', ({ spaceId }) => replaceConversation(spaceId, [], null));

  hub.on('chat.resume', async ({ spaceId, sessionId }) => {
    const { path } = await registry.get(spaceId);
    const events = await history.events(path, sessionId);
    replaceConversation(spaceId, events, sessionId);
  });

  hub.on('permission.reply', ({ requestId, allow }) =>
    permissions.reply(requestId, allow),
  );

  hub.onSubscribe((spaceId, client) => {
    const {
      events,
      status,
      mode,
      model,
      contextFiles,
      missingContext,
      sessionId,
    } = stateOf(spaceId);
    client.send({
      type: 'chat.history',
      spaceId,
      events: [...events],
      status,
      mode,
      model,
      contextFiles,
      missingContext,
      sessionId,
    });
    client.send(statsMessage(spaceId));
    permissions.pendingFor(spaceId).forEach((m) => client.send(m));
  });

  return {
    /** Shared with the experiment loop (one `permission.reply` handler). */
    permissions,
    /** Closes every live session (server shutdown). */
    close: () =>
      states.forEach((s) => {
        s.generation++;
        s.session?.close();
      }),
  };
}
