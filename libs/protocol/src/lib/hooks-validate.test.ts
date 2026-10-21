import { describe, expect, it } from 'vitest';
import { validateGroup } from './hooks-validate.js';

const cmd = { type: 'command', command: 'x' };
const paths = (...a: Parameters<typeof validateGroup>) => validateGroup(...a).map((p) => p.path);

describe('validateGroup', () => {
  it('accepts valid groups of every handler type', () => {
    const hooks = [cmd, { type: 'http', url: 'u' }, { type: 'mcp_tool', server: 's', tool: 't' }, { type: 'prompt', prompt: 'p' }, { type: 'agent', prompt: 'p', timeout: 1.5 }];
    expect(validateGroup('plugin', 'PreToolUse', { matcher: 'Edit|Write', hooks })).toEqual([]);
  });

  it('matcher forms: all, empty, list, regex are fine', () => {
    for (const matcher of ['*', '', 'Edit, Write', 'Edit|Write', '^Notebook', 'mcp__memory__.*', 'Edit.*'])
      expect(validateGroup('plugin', 'PreToolUse', { matcher, hooks: [cmd] })).toEqual([]);
  });

  it('warns on matcher for events that ignore it', () => {
    expect(paths('plugin', 'Stop', { matcher: 'x', hooks: [cmd] })).toEqual(['matcher']);
    expect(paths('plugin', 'UserPromptSubmit', { matcher: '*', hooks: [cmd] })).toEqual(['matcher']);
    expect(paths('plugin', 'SessionStart', { matcher: 'startup', hooks: [cmd] })).toEqual([]);
  });

  it('flags invalid regex and list-looking or glob-looking regexes', () => {
    expect(validateGroup('plugin', 'PreToolUse', { matcher: '(Edit', hooks: [cmd] })[0].message).toMatch(/Invalid/);
    expect(validateGroup('plugin', 'PreToolUse', { matcher: '^Edit, Write', hooks: [cmd] })[0].message).toMatch(/"\|"/);
    expect(validateGroup('plugin', 'PreToolUse', { matcher: 'Notebook*', hooks: [cmd] })[0].message).toMatch(/glob/);
    expect(paths('plugin', 'PreToolUse', { matcher: 5, hooks: [cmd] })).toEqual(['matcher']);
  });

  it('allows `if` only on tool events', () => {
    const g = { hooks: [{ ...cmd, if: 'Bash(git *)' }] };
    expect(validateGroup('plugin', 'PostToolUse', g)).toEqual([]);
    expect(paths('plugin', 'Stop', g)).toEqual(['hooks[0].if']);
  });

  it('allows `once` only for skills', () => {
    const g = { hooks: [{ ...cmd, once: true }] };
    expect(validateGroup('skill', 'Stop', g)).toEqual([]);
    for (const s of ['plugin', 'project', 'local', 'agent'] as const) expect(paths(s, 'Stop', g)).toEqual(['hooks[0].once']);
  });

  it('requires fields per handler type', () => {
    expect(paths('plugin', 'Stop', { hooks: [{ type: 'command' }, { type: 'http' }, { type: 'mcp_tool', server: 's' }, { type: 'prompt' }, { type: 'agent', prompt: '' }] })).toEqual([
      'hooks[0].command', 'hooks[1].url', 'hooks[2].tool', 'hooks[3].prompt', 'hooks[4].prompt',
    ]);
  });

  it('timeout must be a positive number', () => {
    for (const timeout of [0, -1, '5', NaN]) expect(paths('plugin', 'Stop', { hooks: [{ ...cmd, timeout }] })).toEqual(['hooks[0].timeout']);
    expect(validateGroup('plugin', 'Stop', { hooks: [{ ...cmd, timeout: 5 }] })).toEqual([]);
  });

  it('flags unknown handler type, empty hooks, bad shapes and unknown events', () => {
    expect(paths('plugin', 'Stop', { hooks: [{ type: 'shell' }] })).toEqual(['hooks[0].type']);
    expect(paths('plugin', 'Stop', { hooks: [] })).toEqual(['hooks']);
    expect(paths('plugin', 'Stop', { hooks: 1 })).toEqual(['hooks']);
    expect(paths('plugin', 'Stop', 'x')).toEqual(['']);
    expect(paths('plugin', 'Nope', { hooks: [cmd] })).toEqual(['']);
  });
});
