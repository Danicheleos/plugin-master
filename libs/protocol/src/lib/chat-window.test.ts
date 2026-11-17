import { describe, expect, it } from 'vitest';
import type { ChatEvent } from './chat.js';
import { chatWindowStart } from './chat-window.js';

const text = (t: string): ChatEvent => ({ kind: 'text', text: t });
const use = (id: string, parentToolUseId?: string): ChatEvent => ({
  kind: 'tool_use',
  id,
  name: 'Read',
  input: {},
  ...(parentToolUseId && { parentToolUseId }),
});
const res = (id: string, parentToolUseId?: string): ChatEvent => ({
  kind: 'tool_result',
  toolUseId: id,
  isError: false,
  preview: '',
  ...(parentToolUseId && { parentToolUseId }),
});

describe('chatWindowStart', () => {
  it('keeps everything that fits', () => {
    expect(chatWindowStart([text('a'), text('b')], 2)).toBe(0);
    expect(chatWindowStart([], 2)).toBe(0);
  });

  it('cuts before the last N rows', () => {
    expect(chatWindowStart([text('a'), text('b'), text('c')], 2)).toBe(1);
  });

  it('counts a run of master tool events as one row and never splits it', () => {
    const events = [
      text('a'),
      use('1'),
      res('1'),
      use('2'),
      res('2'),
      text('b'),
    ];
    expect(chatWindowStart(events, 2)).toBe(1);
    expect(chatWindowStart(events, 1)).toBe(5);
  });

  it('does not count subagent events, and they do not split a tool row', () => {
    const events = [
      text('a'),
      use('A'),
      ...Array.from({ length: 100 }, (_, i) => use(`s${i}`, 'A')),
      res('A'),
      text('b'),
    ];
    expect(chatWindowStart(events, 2)).toBe(1);
  });
});
