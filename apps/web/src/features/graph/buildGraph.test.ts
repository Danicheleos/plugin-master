import { describe, expect, it } from 'vitest';
import { buildGraph, commandScripts, layoutGraph, type GraphInput } from './buildGraph';

const base: GraphInput = { files: [], texts: {}, hooks: [], mcpServers: [], cases: [] };
const ids = (r: ReturnType<typeof buildGraph>) => r.edges.map((e) => e.id).sort();

describe('buildGraph', () => {
  it('creates nodes of every kind', () => {
    const g = buildGraph({
      ...base,
      files: ['.claude-plugin/plugin.json', 'skills/a/SKILL.md', 'agents/x.md', 'commands/go.md', '.mcp.json'],
      hooks: [{ file: 'hooks/hooks.json', event: 'PreToolUse', group: 0, matcher: 'Bash', handlers: [] }],
      mcpServers: ['fs'],
      cases: [{ name: 'c1', dir: 'evals/cases/c1' }],
    });
    expect(g.nodes.map((n) => n.kind).sort()).toEqual(['agent', 'case', 'command', 'hook', 'manifest', 'mcp', 'skill']);
    expect(g.nodes.find((n) => n.kind === 'hook')?.label).toBe('PreToolUse (Bash)');
  });

  it('links hooks to scripts and drops missing scripts', () => {
    const hooks = [
      { file: 'hooks/hooks.json', event: 'Stop', group: 0, handlers: [{ command: 'bash ${CLAUDE_PLUGIN_ROOT}/scripts/a.sh && ${CLAUDE_PLUGIN_ROOT}/scripts/gone.sh' }, { command: 'echo hi' }] },
    ];
    const g = buildGraph({ ...base, files: ['scripts/a.sh'], hooks });
    expect(ids(g)).toEqual(['hook:hooks/hooks.json:Stop:0>file:scripts/a.sh']);
    expect(g.nodes.map((n) => n.id)).not.toContain('file:scripts/gone.sh');
    expect(commandScripts('x ${CLAUDE_PLUGIN_ROOT}/../out.sh')).toEqual([]);
  });

  it('links skills to referenced files and other skills, dropping unresolved links', () => {
    const text = '---\nname: a\n---\nSee [r](references/r.md), [b](../b/SKILL.md), [x](references/none.md) and https://e.com/y.md\n';
    const g = buildGraph({
      ...base,
      files: ['skills/a/SKILL.md', 'skills/b/SKILL.md', 'skills/a/references/r.md'],
      texts: { 'skills/a/SKILL.md': text },
    });
    expect(ids(g)).toEqual(['skills/a/SKILL.md>file:skills/a/references/r.md', 'skills/a/SKILL.md>skills/b/SKILL.md']);
  });

  it('links agents to listed skills and skills/agents to their frontmatter hooks', () => {
    const g = buildGraph({
      ...base,
      files: ['skills/a/SKILL.md', 'agents/x.md'],
      texts: { 'agents/x.md': '---\nname: x\nskills:\n  - a\n  - ghost\n---\nbody' , 'skills/a/SKILL.md': '---\nname: a\n---\n'},
      hooks: [
        { file: 'skills/a/SKILL.md', event: 'Stop', group: 0, handlers: [] },
        { file: 'agents/x.md', event: 'Stop', group: 0, handlers: [] },
        { file: 'nowhere.md', event: 'Stop', group: 0, handlers: [] },
      ],
    });
    expect(ids(g)).toEqual([
      'agents/x.md>hook:agents/x.md:Stop:0',
      'agents/x.md>skills/a/SKILL.md',
      'skills/a/SKILL.md>hook:skills/a/SKILL.md:Stop:0',
    ]);
  });
});

describe('layoutGraph', () => {
  it('uses one column per present kind with sorted rows', () => {
    const g = buildGraph({ ...base, files: ['skills/b/SKILL.md', 'skills/a/SKILL.md', 'agents/z.md'] });
    const pos = layoutGraph(g.nodes);
    expect(pos.get('skills/a/SKILL.md')).toEqual({ x: 0, y: 0 });
    expect(pos.get('skills/b/SKILL.md')).toEqual({ x: 0, y: 56 });
    expect(pos.get('agents/z.md')?.x).toBe(260);
  });
});
