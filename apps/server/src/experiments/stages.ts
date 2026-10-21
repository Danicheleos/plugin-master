import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  query,
  type CanUseTool,
  type Options,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { StageRole } from '@pm/protocol';
import { resolveInSpace } from '../files/safe-path';
import type { Recorder } from '../runs/recorder';
import { ANALYST_STAGE, EXECUTOR_STAGE, MASTER_STAGE } from './prompts';

const STAGE_PROMPTS: Record<StageRole, string> = {
  master: MASTER_STAGE,
  executor: EXECUTOR_STAGE,
  analyst: ANALYST_STAGE,
};

export type StageErrorCode = 'ABORTED' | 'SDK_ERROR' | 'INVALID_OUTPUT';
export class StageError extends Error {
  constructor(
    readonly code: StageErrorCode,
    message: string,
    /** spent before the failure, when the SDK reported it */
    readonly costUsd?: number,
  ) {
    super(message);
  }
}

/** The part of the SDK `query()` a stage needs; tests substitute a fake. */
export type StageQuery = (p: {
  prompt: string;
  options: Options;
}) => AsyncIterable<SDKMessage>;

export type PermissionRequest = {
  toolName: string;
  input: Record<string, unknown>;
  signal: AbortSignal;
};

export type StageParams<S extends z.ZodType> = {
  role: StageRole;
  /** master: space root; executor/analyst: the experiment worktree */
  cwd: string;
  /** the run is stored under this root (the space), not under cwd */
  spaceRoot: string;
  prompt: string;
  schema: S;
  recorder: Recorder;
  signal?: AbortSignal;
  /** executor only: decides tools that are neither read nor in-worktree edits; default deny */
  onPermission?: (r: PermissionRequest) => Promise<boolean>;
  /** analyst: extra readable dirs, e.g. the eval results of the worktree run */
  additionalDirectories?: string[];
  /** replaces the role's system prompt addition */
  systemPrompt?: string;
  model?: string;
  maxTurns?: number;
  /** SDK cap for this stage (`error_max_budget_usd` when hit) */
  maxBudgetUsd?: number;
  queryFn?: StageQuery;
};

export type StageResult<S extends z.ZodType> = {
  result: z.infer<S>;
  /** also the run id under `<spaceRoot>/.plugin-master/runs/` */
  sessionId: string;
  costUsd: number;
  turns: number;
};

const READ = new Set(['Read', 'Glob', 'Grep']);
const EDIT: Record<string, string> = {
  Edit: 'file_path',
  Write: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};
const deny = (message: string) => ({ behavior: 'deny' as const, message });

const inside = (root: string, p: string) =>
  p === root || p.startsWith(root + path.sep);

/**
 * `t` (relative to `root`, or absolute under `root` or its realpath: the CLI passes realpaths, e.g. `/private/tmp`
 * for `/tmp`) as an absolute path under the real root; throws when it escapes, also through symlinks.
 */
function underRoot(root: string, real: string, t: string): string {
  const abs = path.resolve(root, t);
  const base = inside(root, abs) ? root : inside(real, abs) ? real : null;
  if (base === null) throw new Error('outside');
  return resolveInSpace(real, path.relative(base, abs));
}
const realOr = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/** Same file, so `.GIT` on a case-insensitive disk is caught as `.git`. */
const sameFile = (a: string, b: string) => {
  const x = statSync(a, { throwIfNoEntry: false });
  const y = statSync(b, { throwIfNoEntry: false });
  return !!x && !!y && x.ino === y.ino && x.dev === y.dev;
};
/** Never edited by the executor: git metadata (the worktree's `.git` file points to the main repo) and app state. */
const OFF_LIMITS = ['.git', '.plugin-master'];
/**
 * Edits that can run code on the host (hooks, MCP/LSP servers, scripts, settings) or change the eval itself:
 * the eval runs the worktree with `--trust-plugin`, so these need the user's approval like any other tool.
 */
const NEEDS_APPROVAL =
  /(^|\/)(hooks|scripts|bin|evals|\.claude|\.claude-plugin)\/|(^|\/)\.(mcp|lsp)\.json$|\.(sh|bash|zsh|[cm]?js|ts|py|rb|pl|ps1)$/i;

/** Permission policy per role. Pure aside from filesystem lookups, so tests drive it directly. */
export function stagePolicy(
  p: Pick<StageParams<z.ZodType>, 'role' | 'cwd' | 'onPermission' | 'additionalDirectories'>,
): CanUseTool {
  const roots = [p.cwd, ...(p.additionalDirectories ?? [])].map((r) => ({ root: path.resolve(r), real: realOr(r) }));
  const cwd = roots[0]!;
  const readable = (t: string) =>
    roots.some((r) => {
      try {
        return !!underRoot(r.root, r.real, path.resolve(p.cwd, t));
      } catch {
        return false;
      }
    });
  return async (toolName, input, { signal }) => {
    const ask = async (updatedInput: Record<string, unknown>) =>
      p.onPermission && (await p.onPermission({ toolName, input: updatedInput, signal }))
        ? { behavior: 'allow' as const, updatedInput }
        : deny('Denied by user');
    if (READ.has(toolName)) {
      // reads stay inside the readable roots (Glob/Grep without a path use cwd)
      const t = input.file_path ?? input.path;
      if (t === undefined) return { behavior: 'allow', updatedInput: input };
      if (typeof t === 'string' && readable(t))
        return { behavior: 'allow', updatedInput: input };
      return deny('outside the readable directories');
    }
    if (p.role !== 'executor') return deny('read-only stage');
    const key = EDIT[toolName];
    if (key) {
      const t = input[key];
      if (typeof t !== 'string') return deny('missing path');
      try {
        const abs = underRoot(cwd.root, cwd.real, t);
        const rel = path.relative(cwd.real, abs);
        const first = rel.split(path.sep)[0]!;
        if (OFF_LIMITS.some((n) => n === first.toLowerCase() || sameFile(path.join(cwd.real, first), path.join(cwd.real, n))))
          return deny(`${first} is off limits`);
        // the checked absolute path: the tool must not reinterpret it (e.g. expand `~`)
        const checked = { ...input, [key]: abs };
        if (!NEEDS_APPROVAL.test(rel.split(path.sep).join('/')))
          return { behavior: 'allow', updatedInput: checked };
        return ask(checked);
      } catch {
        return deny('outside the worktree');
      }
    }
    return ask(input);
  };
}

/** Draft-07 without `$schema`: the CLI's --json-schema validator rejects the draft 2020-12 meta-schema. */
export function stageJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { target: 'draft-07' }) as Record<string, unknown>;
  return rest;
}

/** Runs one stage session to its structured result. Never bypasses permissions. */
export async function runStage<S extends z.ZodType>(
  p: StageParams<S>,
): Promise<StageResult<S>> {
  const aborted = () => new StageError('ABORTED', 'Stage aborted');
  if (p.signal?.aborted) throw aborted();
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  p.signal?.addEventListener('abort', onAbort, { once: true });
  const writer = p.recorder.start(p.spaceRoot);
  writer.user(p.prompt);
  const options: Options = {
    cwd: p.cwd,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: p.systemPrompt ?? STAGE_PROMPTS[p.role] },
    // project settings could add allow rules or hooks that bypass canUseTool
    settingSources: [],
    permissionMode: 'default',
    canUseTool: stagePolicy(p),
    // no subagents: their tool calls and cost are harder to bound
    disallowedTools: ['Task', 'Agent', ...(p.role === 'executor' ? [] : ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])],
    additionalDirectories: p.additionalDirectories,
    outputFormat: { type: 'json_schema', schema: stageJsonSchema(p.schema) },
    maxTurns: p.maxTurns,
    maxBudgetUsd: p.maxBudgetUsd,
    model: p.model,
    abortController: ac,
  };
  let sessionId = '';
  try {
    for await (const m of (p.queryFn ?? query)({ prompt: p.prompt, options })) {
      writer.message(m);
      if ('session_id' in m && typeof m.session_id === 'string') sessionId = m.session_id;
      if (m.type !== 'result') continue;
      if (m.subtype !== 'success') {
        throw new StageError(
          m.subtype === 'error_max_structured_output_retries' ? 'INVALID_OUTPUT' : 'SDK_ERROR',
          `Stage failed: ${m.subtype}`,
          m.total_cost_usd,
        );
      }
      if (m.structured_output === undefined)
        throw new StageError('INVALID_OUTPUT', 'The stage returned no structured output', m.total_cost_usd);
      const r = p.schema.safeParse(m.structured_output);
      if (!r.success)
        throw new StageError('INVALID_OUTPUT', `Invalid stage output: ${z.prettifyError(r.error)}`, m.total_cost_usd);
      return { result: r.data, sessionId, costUsd: m.total_cost_usd, turns: m.num_turns };
    }
    throw new StageError('SDK_ERROR', 'The stage ended without a result');
  } catch (e) {
    if (p.signal?.aborted) throw aborted();
    if (e instanceof StageError) throw e;
    throw new StageError('SDK_ERROR', e instanceof Error ? e.message : String(e));
  } finally {
    p.signal?.removeEventListener('abort', onAbort);
  }
}
