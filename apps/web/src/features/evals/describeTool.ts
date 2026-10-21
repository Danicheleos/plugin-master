export type ToolKind = 'skill' | 'read' | 'edit' | 'bash' | 'agent' | 'other';

export const toolKind = (name: string): ToolKind =>
  name === 'Skill'
    ? 'skill'
    : ['Read', 'Glob', 'Grep'].includes(name)
      ? 'read'
      : ['Write', 'Edit', 'NotebookEdit', 'MultiEdit'].includes(name)
        ? 'edit'
        : name === 'Bash'
          ? 'bash'
          : name === 'Task' || name === 'Agent'
            ? 'agent'
            : 'other';

const KEYS: Record<string, string[]> = {
  Skill: ['skill', 'command'],
  Read: ['file_path', 'path'],
  Glob: ['pattern'],
  Grep: ['pattern'],
  Write: ['file_path'],
  Edit: ['file_path'],
  MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path'],
  Bash: ['command'],
  Task: ['description', 'prompt'],
  Agent: ['description', 'prompt'],
};

const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** One-line key argument of a tool call; falls back to the raw (truncated) input if it is not JSON. */
export function describeTool(name: string, inputJson: string): string {
  let input: unknown;
  try {
    input = JSON.parse(inputJson);
  } catch {
    return short(inputJson);
  }
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    const keys = KEYS[name] ?? [];
    for (const k of keys) if (typeof o[k] === 'string' && o[k]) return short(o[k] as string);
    const first = Object.values(o).find((v) => typeof v === 'string' && v);
    if (first) return short(first as string);
  }
  return short(inputJson);
}
