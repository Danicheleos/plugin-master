import { describe, expect, it } from 'vitest';
import { HOOK_EVENTS, readHooks, writeHooks } from './hooks.js';

const handlers = [
  { type: 'command', command: 'echo hi', timeout: 5, extra: 1 },
  { type: 'http', url: 'http://localhost/x', headers: { a: 'b' } },
  { type: 'mcp_tool', server: 's', tool: 't', input: { x: 1 } },
  { type: 'prompt', prompt: 'ok?', model: 'm' },
  { type: 'agent', prompt: 'check' },
];

describe('hooks', () => {
  it('has 33 unique events', () => {
    expect(new Set(HOOK_EVENTS).size).toBe(33);
  });

  it('reads every handler type from each source shape', () => {
    const cfg = { description: 'd', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: handlers }, { hooks: [] }] } };
    for (const source of ['plugin', 'project', 'local', 'skill', 'agent'] as const) {
      const e = readHooks(source, 'f', cfg);
      expect(e).toHaveLength(2);
      expect(e[0]).toMatchObject({ source, file: 'f', event: 'PreToolUse', group: 0, matcher: 'Bash' });
      expect(e[0].handlers).toEqual(handlers);
      expect(e[1]).toMatchObject({ group: 1, handlers: [], problems: [] });
      expect(e[1].matcher).toBeUndefined();
    }
  });

  it('is tolerant: unknown events and malformed pieces become problems', () => {
    const e = readHooks('project', 'f', {
      hooks: { Bogus: [{ hooks: [{ type: 'command', command: 'x' }] }], Stop: 'nope', PreToolUse: [1, { matcher: 3, hooks: [null, { type: 'command' }] }, { hooks: 'x' }] },
    });
    expect(e.find((x) => x.event === 'Bogus')).toMatchObject({ handlers: [{ type: 'command' }] });
    expect(e.find((x) => x.event === 'Bogus')?.problems[0].message).toMatch(/Unknown event/);
    expect(e.find((x) => x.event === 'Stop')?.problems[0].message).toMatch(/array/);
    const pre = e.filter((x) => x.event === 'PreToolUse');
    expect(pre[0].problems[0].message).toMatch(/object/);
    expect(pre[1].problems.map((p) => p.path)).toEqual(['hooks.PreToolUse[1].matcher', 'hooks.PreToolUse[1].hooks[0]']);
    expect(pre[1].handlers).toHaveLength(1);
    expect(pre[2].problems[0].path).toBe('hooks.PreToolUse[2].hooks');
  });

  it('handles missing or non-object config and hooks', () => {
    expect(readHooks('plugin', 'f', null)).toEqual([]);
    expect(readHooks('plugin', 'f', { a: 1 })).toEqual([]);
    expect(readHooks('plugin', 'f', { hooks: [] })[0].problems).toHaveLength(1);
  });

  it('write keeps other keys and other events, without mutating the input', () => {
    const cfg = { permissions: { allow: ['x'] }, env: { A: '1' }, hooks: { Stop: [{ hooks: [] }], Weird: 5 } };
    const copy = structuredClone(cfg);
    const next = writeHooks(cfg, 'PreToolUse', [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'c' }] }]);
    expect(cfg).toEqual(copy);
    expect(next).toEqual({ ...copy, hooks: { ...copy.hooks, PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'c' }] }] } });
    expect(readHooks('project', 'f', next).some((e) => e.event === 'PreToolUse')).toBe(true);
  });

  it('write creates the hooks key when absent', () => {
    expect(writeHooks({ a: 1 }, 'Stop', [{ hooks: [] }])).toEqual({ a: 1, hooks: { Stop: [{ hooks: [] }] } });
  });

  it('write [] drops the event key, and hooks when it becomes empty', () => {
    expect(writeHooks({ a: 1, hooks: { Stop: [{ hooks: [] }], Setup: [] } }, 'Stop', [])).toEqual({ a: 1, hooks: { Setup: [] } });
    expect(writeHooks({ a: 1, hooks: { Stop: [{ hooks: [] }] } }, 'Stop', [])).toEqual({ a: 1 });
    expect(writeHooks({ description: 'd', hooks: { Stop: [{ hooks: [] }] } }, 'Stop', [])).toEqual({ description: 'd' });
  });

  it('write [] of an absent event leaves the config as it was, including an empty hooks', () => {
    expect(writeHooks({ a: 1, hooks: {} }, 'Stop', [])).toEqual({ a: 1, hooks: {} });
    expect(writeHooks({ a: 1 }, 'Stop', [])).toEqual({ a: 1 });
  });
});
