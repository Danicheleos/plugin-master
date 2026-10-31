import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_PRESETS, loadAgentPresets, parseAgentFile } from './agent-presets';

async function space(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'pm-agents-'));
  await mkdir(join(root, '.plugin-master/agents'), { recursive: true });
  for (const [f, c] of Object.entries(files)) await writeFile(join(root, '.plugin-master/agents', f), c);
  return root;
}

describe('default presets', () => {
  it('never name an mcp__ tool and disallow the master-only servers', () => {
    for (const [name, def] of Object.entries(DEFAULT_AGENT_PRESETS)) {
      expect((def.tools ?? []).some((t) => t.startsWith('mcp__')), name).toBe(false);
      expect(def.disallowedTools).toEqual(['mcp__plan', 'mcp__evals']);
      expect(def.prompt).toContain('Seen on the way:');
      expect(def.prompt).toContain('Not verified:');
    }
  });
});

describe('built-in overrides', () => {
  // CLI 2.1.301 defines Explore and Plan with model "inherit" (the master's Opus); a flag-source agent of the same name replaces the built-in
  it.each([['Explore', 'haiku'], ['Plan', 'claude-sonnet-5-5'], ['general-purpose', 'claude-sonnet-5-5']])(
    '%s has its own model %s',
    (name, model) => {
      expect(DEFAULT_AGENT_PRESETS[name]?.model).toBe(model);
      expect(DEFAULT_AGENT_PRESETS[name]?.disallowedTools).toEqual(['mcp__plan', 'mcp__evals']);
    },
  );
  it('keeps Explore and Plan read-only', () => {
    for (const n of ['Explore', 'Plan']) expect(DEFAULT_AGENT_PRESETS[n]?.tools).toEqual(['Read', 'Grep', 'Glob', 'Bash']);
  });
});

describe('loadAgentPresets', () => {
  it('returns the defaults when the dir is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pm-agents-'));
    expect(await loadAgentPresets(root)).toEqual(DEFAULT_AGENT_PRESETS);
  });

  it('merges by name: a space file overrides its preset and keeps the others', async () => {
    const root = await space({
      'reader.md': '---\nname: reader\ndescription: Custom reader\nmodel: sonnet\ntools: Read, Grep, mcp__plan__plan_get\neffort: high\n---\nRead only, custom.\n',
      'extra.md': '---\ndescription: Extra\n---\nDo extra.',
    });
    const out = await loadAgentPresets(root);
    expect(Object.keys(out).sort()).toEqual(['Explore', 'Plan', 'extra', 'general-purpose', 'reader', 'runner', 'writer']);
    expect(out.reader).toEqual({
      description: 'Custom reader',
      model: 'sonnet',
      tools: ['Read', 'Grep'],
      effort: 'high',
      disallowedTools: ['mcp__plan', 'mcp__evals'],
      prompt: 'Read only, custom.',
    });
    expect(out.writer).toBe(DEFAULT_AGENT_PRESETS.writer);
    expect(out.extra?.tools).toBeUndefined(); // inherits, but the master-only servers are disallowed
    expect(out.extra?.disallowedTools).toEqual(['mcp__plan', 'mcp__evals']);
  });

  it('skips an invalid file with a warning and keeps the default of that name', async () => {
    const root = await space({
      'writer.md': '---\nname: writer\n---\nno description',
      'runner.md': '---\nname: runner\ndescription: d\neffort: loud\n---\np',
      'reader.md': '---\nname: [unclosed\n---\np',
    });
    const warnings: string[] = [];
    const out = await loadAgentPresets(root, (m) => warnings.push(m));
    expect(out).toEqual(DEFAULT_AGENT_PRESETS);
    expect(warnings).toHaveLength(3);
    expect(warnings.join('\n')).toContain('writer.md');
  });
});

describe('parseAgentFile', () => {
  it('takes the name from the file when the frontmatter has none, and accepts a tools list', () => {
    const [name, def] = parseAgentFile('---\ndescription: d\ntools:\n  - Bash\n  - Read\ndisallowedTools: Write\n---\nbody', 'qa.md');
    expect(name).toBe('qa');
    expect(def.tools).toEqual(['Bash', 'Read']);
    expect(def.disallowedTools).toEqual(['Write', 'mcp__plan', 'mcp__evals']);
  });
});
