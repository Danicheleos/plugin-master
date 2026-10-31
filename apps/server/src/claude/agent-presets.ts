import { readdir, readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { resolveInSpace } from '../files/safe-path';
import { splitFrontmatter } from '../lib/frontmatter';
import { EVAL_SERVER } from '../evals/tools';
import { PLAN_SERVER } from '../plans/tools';

export const AGENTS_DIR = '.plugin-master/agents';
/**
 * Default model of every subagent (`CLAUDE_CODE_SUBAGENT_MODEL`, used when neither the Agent call
 * nor the agent definition names a model; without it the CLI inherits the master's Opus).
 */
export const SUBAGENT_MODEL = 'claude-sonnet-5-5';

/** Server-level specs: an agent never gets the master's plan/eval tools, whatever its `tools` says. */
const MASTER_ONLY_MCP = [`mcp__${PLAN_SERVER}`, `mcp__${EVAL_SERVER}`];

const REPORT =
  'End your report with two sections: "Seen on the way:" (errors, warnings, anything odd outside the task) and "Not verified:" (what you did not check or could not run).';

const preset = (
  description: string,
  model: string,
  tools: string[] | undefined,
  prompt: string,
): AgentDefinition => ({
  description,
  model,
  ...(tools && { tools }),
  disallowedTools: MASTER_ONLY_MCP,
  prompt: `${prompt}\n\n${REPORT}`,
});

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];

/** Used for every name a space does not define itself. Explicit `tools` keep the `mcp__*` tools out. */
export const DEFAULT_AGENT_PRESETS: Record<string, AgentDefinition> = {
  reader: preset(
    'Read-only: reads code, traces and logs, and searches. Never changes files.',
    'haiku',
    READ_ONLY_TOOLS,
    'You are read-only. Never edit or create files; use Bash only for reading commands (ls, cat, grep, git log/diff/show). Answer the question from the brief with exact paths and line numbers.',
  ),
  writer: preset(
    'Makes edits, runs tests and commits.',
    SUBAGENT_MODEL,
    ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
    'You make the change the brief asks for, no more. Run the tests it names and commit only the paths you changed when the brief says so.',
  ),
  runner: preset(
    'Runs long or paid commands and reports their output.',
    SUBAGENT_MODEL,
    ['Bash', 'Read'],
    'You run the commands the brief names, exactly as written, and report the real output and exit codes. Do not edit files or fix failures.',
  ),
  // CLI 2.1.301 defines Explore and Plan with model "inherit" (the master's Opus), and a definition model beats
  // CLAUDE_CODE_SUBAGENT_MODEL. A flag-source agent of the same name replaces the built-in, so these keep the
  // built-ins' jobs on cheaper models. general-purpose has no model of its own; it is pinned for clarity.
  Explore: preset(
    'Fast read-only search agent for locating code: finds files by pattern, searches code for keywords, answers questions about the codebase. Say how thorough: "quick", "medium" or "very thorough".',
    'haiku',
    READ_ONLY_TOOLS,
    'You are read-only. Never edit or create files; use Bash only for reading commands. Search broadly, read excerpts, and report exact paths and line numbers.',
  ),
  Plan: preset(
    'Software architect agent for designing implementation plans: returns step-by-step plans, critical files and trade-offs. Read-only.',
    SUBAGENT_MODEL,
    READ_ONLY_TOOLS,
    'You are read-only. Never edit or create files; use Bash only for reading commands. Explore the code the brief names and return a step-by-step implementation plan with the critical files and the trade-offs.',
  ),
  'general-purpose': preset(
    'General-purpose agent for researching complex questions, searching for code and executing multi-step tasks.',
    SUBAGENT_MODEL,
    undefined,
    'You do the task the brief describes, no more, and report the result.',
  ),
};

const list = (v: unknown): string[] | undefined => {
  const items = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : undefined;
  return items?.map((t) => String(t).trim()).filter(Boolean);
};

/** One agent file in the Claude Code format; throws on an invalid file. */
export function parseAgentFile(src: string, file: string): [string, AgentDefinition] {
  const { data, body } = splitFrontmatter(src);
  const str = (k: string) => (typeof data[k] === 'string' && data[k] ? (data[k] as string) : undefined);
  const name = str('name') ?? basename(file, extname(file));
  const description = str('description');
  const prompt = body.trim();
  if (!description) throw new Error('no "description" in the frontmatter');
  if (!prompt) throw new Error('empty prompt (the text after the frontmatter)');
  const def: AgentDefinition = { description, prompt };
  const model = str('model');
  if (model) def.model = model;
  const tools = list(data.tools)?.filter((t) => !t.startsWith('mcp__'));
  if (tools) def.tools = tools;
  def.disallowedTools = [...(list(data.disallowedTools) ?? []), ...MASTER_ONLY_MCP];
  const effort = data.effort;
  if (effort !== undefined) {
    if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(effort as string) && typeof effort !== 'number')
      throw new Error(`bad "effort": ${String(effort)}`);
    def.effort = effort as AgentDefinition['effort'];
  }
  return [name, def];
}

/**
 * Defaults merged by name with `<root>/.plugin-master/agents/*.md`: a space file replaces the
 * same-named default and the other defaults stay. An invalid file is skipped with a warning, so
 * its name keeps the default.
 */
export async function loadAgentPresets(
  root: string,
  warn: (msg: string) => void = console.warn,
): Promise<Record<string, AgentDefinition>> {
  const out = { ...DEFAULT_AGENT_PRESETS };
  const dir = resolveInSpace(root, AGENTS_DIR);
  const files = await readdir(dir).catch(() => [] as string[]);
  for (const f of files.filter((f) => f.endsWith('.md')).sort()) {
    try {
      const [name, def] = parseAgentFile(await readFile(`${dir}/${f}`, 'utf8'), f);
      out[name] = def;
    } catch (e) {
      warn(`agent file ${AGENTS_DIR}/${f} skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
