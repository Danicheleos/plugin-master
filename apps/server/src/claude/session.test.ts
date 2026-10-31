import { describe, expect, it } from 'vitest';
import {
  MASTER_MODEL,
  sessionQueryOptions,
  SUBAGENT_MODEL,
  toContextUsage,
  type SessionOptions,
} from './session';

const o: SessionOptions = {
  cwd: '/space',
  appendSystemPrompt: 'ctx',
  mode: 'default',
  model: 'claude-opus-5-5',
  canUseTool: async () => ({ behavior: 'deny', message: 'no' }),
  onMessage: () => undefined,
  onError: () => undefined,
};

describe('sessionQueryOptions', () => {
  it('runs the master on Opus with a 300k auto-compact window and Sonnet subagents', () => {
    const opts = sessionQueryOptions(o, { PATH: '/bin', HOME: '/h' });
    expect(MASTER_MODEL).toBe('claude-opus-5-5');
    expect(SUBAGENT_MODEL).toBe('claude-sonnet-5-5');
    expect(opts.model).toBe('claude-opus-5-5');
    expect(opts.env).toEqual({
      PATH: '/bin',
      HOME: '/h',
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000',
      CLAUDE_CODE_SUBAGENT_MODEL: 'claude-sonnet-5-5',
    });
    expect(Object.keys(opts.hooks ?? {}).sort()).toEqual(['PreToolUse', 'SessionStart', 'UserPromptSubmit']);
    expect(opts).toMatchObject({
      cwd: '/space',
      permissionMode: 'default',
      settingSources: ['project'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'ctx' },
    });
  });

  it('carries the reader/writer/runner presets and never sets FORCE, even when inherited', () => {
    const opts = sessionQueryOptions(o, { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' });
    expect(opts.env?.CLAUDE_CODE_SUBAGENT_MODEL_FORCE).toBeUndefined();
    expect(opts.env?.CLAUDE_CODE_SUBAGENT_MODEL).toBe('claude-sonnet-5-5');
    expect(Object.keys(opts.agents ?? {}).sort()).toEqual(['reader', 'runner', 'writer']);
    expect(opts.agents?.reader).toMatchObject({ model: 'haiku', tools: ['Read', 'Grep', 'Glob', 'Bash'] });
    expect(opts.agents?.writer?.model).toBe('claude-sonnet-5-5');
    expect(opts.agents?.runner?.tools).toEqual(['Bash', 'Read']);
  });

  it('keeps default presets for names the session options do not override', () => {
    const custom = { description: 'd', prompt: 'p', model: 'haiku' };
    const agents = sessionQueryOptions({ ...o, agents: { reader: custom } }).agents;
    expect(agents?.reader).toBe(custom);
    expect(Object.keys(agents ?? {}).sort()).toEqual(['reader', 'runner', 'writer']);
  });

  it('adds no flag settings for the default config', () => {
    for (const userSettings of [true, false]) {
      const opts = sessionQueryOptions({ ...o, userSettings, disabledPlugins: [], autoMemory: true }, { PATH: '/bin' });
      expect(opts.settings).toBeUndefined();
      expect(opts.env).not.toHaveProperty('CLAUDE_CODE_DISABLE_AUTO_MEMORY');
    }
  });

  it('turns disabledPlugins into enabledPlugins false flag settings in both userSettings modes', () => {
    for (const userSettings of [true, false]) {
      const opts = sessionQueryOptions({ ...o, userSettings, disabledPlugins: ['a@m', 'b@m'] });
      expect(opts.settings).toEqual({ enabledPlugins: { 'a@m': false, 'b@m': false } });
    }
  });

  it('turns autoMemory false into autoMemoryEnabled false and clears an inherited DISABLE_AUTO_MEMORY=0', () => {
    for (const userSettings of [true, false]) {
      const opts = sessionQueryOptions({ ...o, userSettings, autoMemory: false }, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' });
      expect(opts.settings).toEqual({ autoMemoryEnabled: false });
      expect(opts.env).toHaveProperty('CLAUDE_CODE_DISABLE_AUTO_MEMORY', undefined);
    }
  });

  it('loads user and local settings only when userSettings is on', () => {
    expect(sessionQueryOptions({ ...o, userSettings: true }).settingSources).toEqual(['user', 'project', 'local']);
    expect(sessionQueryOptions({ ...o, userSettings: false }).settingSources).toEqual(['project']);
  });

  it('inherits process.env by default and overrides a user subagent model', () => {
    process.env.PM_TEST_INHERITED = 'yes';
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'haiku';
    try {
      const env = sessionQueryOptions(o).env;
      expect(env?.PM_TEST_INHERITED).toBe('yes');
      expect(env?.CLAUDE_CODE_SUBAGENT_MODEL).toBe('claude-sonnet-5-5');
    } finally {
      delete process.env.PM_TEST_INHERITED;
      delete process.env.CLAUDE_CODE_SUBAGENT_MODEL;
    }
  });
});

describe('toContextUsage', () => {
  // values captured from a real getContextUsage() with CLAUDE_CODE_AUTO_COMPACT_WINDOW=300000
  const u = {
    totalTokens: 15505,
    rawMaxTokens: 300000,
    percentage: 5,
    autoCompactThreshold: 267000,
    isAutoCompactEnabled: true,
  };
  it('maps the window and the auto-compact threshold', () => {
    expect(toContextUsage(u)).toEqual({
      tokens: 15505,
      max: 300000,
      percent: 5,
      limit: 267000,
    });
  });
  it('has no limit when auto-compact is off', () => {
    expect(
      toContextUsage({ ...u, isAutoCompactEnabled: false }).limit,
    ).toBeNull();
  });
});
