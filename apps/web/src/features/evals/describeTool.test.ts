import { describe, expect, it } from 'vitest';
import { describeTool, toolKind } from './describeTool';

describe('describeTool', () => {
  it('picks the key argument per tool', () => {
    expect(describeTool('Read', '{"file_path":"/a/b.md","limit":5}')).toBe('/a/b.md');
    expect(describeTool('Bash', '{"command":"ls -la"}')).toBe('ls -la');
    expect(describeTool('Skill', '{"skill":"my-skill"}')).toBe('my-skill');
    expect(describeTool('Grep', '{"pattern":"foo","path":"x"}')).toBe('foo');
  });
  it('falls back to the first string, then to the raw input', () => {
    expect(describeTool('mcp__x__y', '{"q":"hello","n":1}')).toBe('hello');
    expect(describeTool('Read', '{"cut":')).toBe('{"cut":');
    expect(describeTool('Read', 'x'.repeat(300))).toHaveLength(121);
  });
  it('classifies tools', () => {
    expect(['Skill', 'Glob', 'Edit', 'Bash', 'Agent', 'mcp__a'].map(toolKind)).toEqual([
      'skill', 'read', 'edit', 'bash', 'agent', 'other',
    ]);
  });
});
