import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  SDKMessage,
  SessionMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import {
  describeToolUse,
  mapSdkMessage,
  mapSessionMessage,
  mapTaskMessage,
} from './map-events';

// Real messages captured from a live SDK run (trimmed), see __fixtures__/.
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8'),
  ) as SDKMessage;
const asMsg = (m: unknown) => m as SDKMessage;

describe('mapSdkMessage', () => {
  it('maps assistant text and tool_use blocks', () => {
    expect(mapSdkMessage(fixture('assistant-text'))).toEqual([
      { kind: 'text', text: 'Done. I created `hi.txt` with the content "hi".' },
    ]);
    expect(mapSdkMessage(fixture('assistant-tool-use'))).toEqual([
      {
        kind: 'tool_use',
        id: expect.stringMatching(/^toolu_/),
        name: 'Write',
        input: { file_path: '/space/hi.txt', content: 'hi' },
      },
    ]);
  });

  it('ignores thinking blocks', () => {
    expect(mapSdkMessage(fixture('assistant-thinking'))).toEqual([]);
  });

  it('maps tool_result with a preview', () => {
    const [e] = mapSdkMessage(fixture('user-tool-result'));
    expect(e).toMatchObject({ kind: 'tool_result', isError: false });
    expect((e as { preview: string }).preview).toMatch(/^File created/);
  });

  it('truncates long previews and reads array content', () => {
    const [e] = mapSdkMessage(
      asMsg({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              is_error: true,
              content: [{ type: 'text', text: 'x'.repeat(900) }],
            },
          ],
        },
      }),
    );
    expect(e).toMatchObject({
      kind: 'tool_result',
      toolUseId: 't1',
      isError: true,
    });
    expect((e as { preview: string }).preview).toHaveLength(500);
  });

  it('maps result with cost and duration', () => {
    expect(mapSdkMessage(fixture('result-success'))).toEqual([
      expect.objectContaining({
        kind: 'result',
        isError: false,
        costUsd: 0.1845079,
      }),
    ]);
  });

  it('ignores other message types', () => {
    expect(mapSdkMessage(asMsg({ type: 'system', subtype: 'init' }))).toEqual(
      [],
    );
  });

  it('maps stored session messages and skips subagent internals', () => {
    const m = (type: string, message: unknown, parent: string | null = null) =>
      ({
        type,
        uuid: 'u',
        session_id: 's',
        message,
        parent_tool_use_id: parent,
        parent_agent_id: null,
      }) as SessionMessage;
    expect(
      [
        m('user', { role: 'user', content: 'hi' }),
        m('assistant', { content: [{ type: 'text', text: 'yo' }] }),
        m('user', {
          content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }],
        }),
        m('assistant', { content: [{ type: 'text', text: 'sub' }] }, 'toolu_1'),
      ].flatMap(mapSessionMessage),
    ).toEqual([
      { kind: 'user', text: 'hi' },
      { kind: 'text', text: 'yo' },
      { kind: 'tool_result', toolUseId: 't', isError: false, preview: 'ok' },
    ]);
  });
});

// Synthetic messages built from the SDK types (not captured from a live run).
describe('mapTaskMessage', () => {
  it('maps task_started, task_progress and task_notification', () => {
    expect(
      mapTaskMessage(
        asMsg({
          type: 'system',
          subtype: 'task_started',
          task_id: 'k1',
          description: 'Research',
          subagent_type: 'Explore',
        }),
      ),
    ).toEqual({
      id: 'k1',
      description: 'Research',
      subagentType: 'Explore',
      status: 'running',
      tokens: 0,
      toolUses: 0,
    });
    expect(
      mapTaskMessage(
        asMsg({
          type: 'system',
          subtype: 'task_progress',
          task_id: 'k1',
          description: 'Research',
          usage: { total_tokens: 900, tool_uses: 3, duration_ms: 5 },
          last_tool_name: 'Read',
        }),
      ),
    ).toEqual({
      id: 'k1',
      description: 'Research',
      tokens: 900,
      toolUses: 3,
      lastTool: 'Read',
    });
    expect(
      mapTaskMessage(
        asMsg({
          type: 'system',
          subtype: 'task_notification',
          task_id: 'k1',
          status: 'completed',
          summary: 'ok',
          usage: { total_tokens: 1000, tool_uses: 4, duration_ms: 9 },
        }),
      ),
    ).toEqual({ id: 'k1', status: 'completed', tokens: 1000, toolUses: 4 });
  });

  it('ignores other messages', () => {
    expect(mapTaskMessage(fixture('result-success'))).toBeUndefined();
    expect(
      mapTaskMessage(asMsg({ type: 'system', subtype: 'init' })),
    ).toBeUndefined();
  });
});

describe('describeToolUse', () => {
  it('summarizes the main input field', () => {
    expect(describeToolUse('Edit', { file_path: '/a/b.md' })).toBe(
      'Edit: /a/b.md',
    );
    expect(describeToolUse('Bash', { command: 'ls\n  -la' })).toBe(
      'Bash: ls -la',
    );
    expect(describeToolUse('Foo', {})).toBe('Foo');
  });
});
