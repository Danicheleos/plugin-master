import {
  CHAT_MODES,
  chatWindowStart,
  type AgentTask,
  type ChatEvent,
  type ChatMode,
  type ChatEffort,
  type ChatModel,
  type ChatStatus,
  type ContextUsage,
} from '@pm/protocol';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AppError } from '../lib/errors';
import { loadAgentPresets } from './agent-presets';
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
import {
  describeToolUse,
  mapSdkBlocks,
  mapSdkMessage,
  mapTaskMessage,
} from './map-events';
import {
  createClaudeSession,
  MASTER_MODEL,
  type Session,
  type SessionFactory,
} from './session';

/**
 * A finished subagent drops out of the post-compaction roster after this long without activity.
 * The roster has no count cap; running tasks always stay. 30 min is a guess, unmeasured: long
 * enough to resume an agent after a compaction, short enough that a long session's roster stays small.
 */
const ROSTER_IDLE_MS = 30 * 60_000;

/** Live events between two cuts of the chat window. */
const TRIM_EVERY = 100;

/** `name` (else `subagent_type`) of the Agent/Task call `toolUseId`, from the chat events. */
function agentName(events: ChatEvent[], toolUseId: string): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== 'tool_use' || e.id !== toolUseId) continue;
    const input = (e.input ?? {}) as {
      name?: unknown;
      subagent_type?: unknown;
    };
    const name = input.name ?? input.subagent_type;
    return typeof name === 'string' && name ? name : undefined;
  }
  return undefined;
}

function rosterTasks(st: Pick<State, 'tasks' | 'taskAt'>): AgentTask[] {
  const now = Date.now();
  return [...st.tasks.values()].filter(
    (t) =>
      t.status === 'running' ||
      now - (st.taskAt.get(t.id) ?? 0) <= ROSTER_IDLE_MS,
  );
}

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
  /** Reasoning effort; survives New session/resume for the server's lifetime. */
  effort: ChatEffort;
  /** the last MAX_CHAT_ROWS rows (see `keepWindow`); `earlier` = events dropped before them */
  events: ChatEvent[];
  earlier: number;
  /** Agent activity shown next to the chat; cleared with the session. */
  master: ContextUsage | null;
  current: string | null;
  tasks: Map<string, AgentTask>;
  /** Time of each task's last update, for the roster after compaction. */
  taskAt: Map<string, number>;
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
          effort: 'default',
          events: [],
          earlier: 0,
          generation: 0,
          contextFiles: null,
          missingContext: [],
          sessionId: null,
          dispatch: Promise.resolve(),
          turns: [],
          master: null,
          current: null,
          tasks: new Map(),
          taskAt: new Map(),
        }),
      );
    return s;
  };

  /** Drops events before the last MAX_CHAT_ROWS rows (memory and `chat.history` stay bounded). */
  function keepWindow(s: State) {
    const start = chatWindowStart(s.events);
    if (!start) return;
    s.earlier += start;
    s.events = s.events.slice(start);
  }
  function emit(spaceId: string, ...events: ChatEvent[]) {
    const s = stateOf(spaceId);
    s.events.push(...events);
    // amortized: the window is cut once per TRIM_EVERY events, and exactly before each history
    if (s.events.length % TRIM_EVERY < events.length) keepWindow(s);
    for (const event of events)
      hub.broadcast(spaceId, { type: 'chat.event', spaceId, event });
  }
  function broadcastStatus(spaceId: string) {
    const {
      status,
      mode,
      model,
      effort,
      contextFiles,
      missingContext,
      sessionId,
    } = stateOf(spaceId);
    hub.broadcast(spaceId, {
      type: 'chat.status',
      spaceId,
      status,
      mode,
      model,
      effort,
      contextFiles,
      missingContext,
      sessionId,
    });
  }
  /** Sets one status field and broadcasts when it changed. */
  function setField<K extends 'status' | 'mode' | 'model' | 'effort'>(
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
  const setEffort = (id: string, v: ChatEffort) => setField(id, 'effort', v);
  const setMode = (id: string, v: ChatMode) => setField(id, 'mode', v);
  const statsMessage = (spaceId: string) => {
    const { master, current, tasks } = stateOf(spaceId);
    return {
      type: 'agent.stats' as const,
      spaceId,
      master,
      current,
      // finished tasks stay in `tasks` (roster after compaction) but are not shown
      tasks: [...tasks.values()].filter((t) => t.status === 'running'),
    };
  };
  const broadcastStats = (spaceId: string) =>
    hub.broadcast(spaceId, statsMessage(spaceId));
  function resetStats(spaceId: string) {
    const s = stateOf(spaceId);
    s.master = null;
    s.current = null;
    s.tasks.clear();
    s.taskAt.clear();
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
      const name =
        !prev && task.toolUseId && agentName(st.events, task.toolUseId);
      if (name) task.name = name;
      st.taskAt.set(task.id, Date.now());
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
    // a subagent's call is its task's action; the master's current action stays its own call
    const parent = (m as { parent_tool_use_id?: string | null })
      .parent_tool_use_id;
    if (parent) {
      const t = [...st.tasks.values()].find((x) => x.toolUseId === parent);
      if (!t || !tool) return;
      t.action = describeToolUse(tool.name, tool.input);
      return broadcastStats(spaceId);
    }
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
    let disabledPlugins: string[];
    let autoMemory: boolean;
    let systemPrompt: 'preset' | 'custom';
    let append: string;
    let missing: string[];
    try {
      ({
        masterContext,
        disabledPlugins,
        autoMemory,
        systemPrompt,
        features: { userSettings },
      } = await spaces.getConfig(spaceId));
      ({ text: append, missing } = await buildContext(
        root,
        masterContext.filter((f) => f !== MASTER_PROMPT_FILE),
      ));
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
    const plansService = createPlansService(root, () =>
      hub.broadcast(spaceId, { type: 'plans.changed', spaceId }),
    );
    const session: Session = newSession({
      cwd: root,
      masterPrompt: append,
      systemPrompt,
      mode: state.mode,
      model: state.model,
      effort: state.effort,
      userSettings,
      disabledPlugins,
      autoMemory,
      pinnedFiles: [
        MASTER_PROMPT_FILE,
        ...masterContext.filter((f) => f !== MASTER_PROMPT_FILE),
      ],
      tasks: () => rosterTasks(state),
      plan: async () => {
        const cur = await plansService.current();
        return (
          cur && {
            title: cur.plan.title,
            phase: cur.plan.phases.find((p) => p.status === 'in_progress')
              ?.title,
          }
        );
      },
      agents: await loadAgentPresets(root),
      resume: state.sessionId ?? undefined,
      canUseTool: permissions.canUseTool(spaceId),
      mcpServers: {
        [PLAN_SERVER]: createPlanMcpServer(plansService),
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
        trackActivity(spaceId, session, m, mapSdkBlocks(m));
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

  hub.on('chat.effort', async ({ spaceId, effort }) => {
    const s = stateOf(spaceId);
    const previous = s.effort;
    const session = s.session;
    setEffort(spaceId, effort);
    try {
      await session?.setEffort(effort);
    } catch (e) {
      if (s.session === session && s.effort === effort)
        setEffort(spaceId, previous);
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
    s.earlier = 0;
    keepWindow(s);
    s.sessionId = sessionId;
    s.contextFiles = null;
    s.missingContext = [];
    s.turns = [];
    resetStats(spaceId);
    hub.broadcast(spaceId, {
      type: 'chat.history',
      spaceId,
      events: [...s.events],
      ...(s.earlier && { earlier: s.earlier }),
      status: 'idle',
      mode: s.mode,
      model: s.model,
      effort: s.effort,
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
    const s = stateOf(spaceId);
    keepWindow(s);
    const {
      status,
      mode,
      model,
      effort,
      contextFiles,
      missingContext,
      sessionId,
    } = s;
    client.send({
      type: 'chat.history',
      spaceId,
      events: [...s.events],
      ...(s.earlier && { earlier: s.earlier }),
      status,
      mode,
      model,
      effort,
      contextFiles,
      missingContext,
      sessionId,
    });
    client.send(statsMessage(spaceId));
    permissions.pendingFor(spaceId).forEach((m) => client.send(m));
  });

  return {
    /** Session id of the conversation shown in the space's chat (null = new session). */
    openSession: (spaceId: string) => states.get(spaceId)?.sessionId ?? null,
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
