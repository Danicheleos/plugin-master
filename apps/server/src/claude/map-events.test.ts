import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { mapSdkMessage } from './map-events';

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
});
