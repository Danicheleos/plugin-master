import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '@pm/protocol';
import {
  callNames,
  countSub,
  pairTools,
  splitSubagents,
  subOf,
  summary,
  toRows,
  type ToolEvent,
} from './toolRows';

const use = (id: string, name = 'Read', parent?: string): ToolEvent => ({
  kind: 'tool_use',
  id,
  name,
  input: { id },
  ...(parent && { parentToolUseId: parent }),
});
const result = (
  toolUseId: string,
  isError = false,
  parent?: string,
): ToolEvent => ({
  kind: 'tool_result',
  toolUseId,
  preview: `out ${toolUseId}`,
  isError,
  ...(parent && { parentToolUseId: parent }),
});
const text = (t: string): ChatEvent => ({ kind: 'text', text: t });

describe('toRows', () => {
  it('groups consecutive tool events and keeps the absolute index of each row', () => {
    const events = [text('a'), use('1'), result('1'), text('b'), use('2')];
    const rows = toRows(events, [10, 11, 12, 13, 14]);
    expect(rows.map((r) => r.at)).toEqual([10, 11, 13, 14]);
    expect('tools' in rows[1] && rows[1].tools).toHaveLength(2);
    expect('e' in rows[2] && rows[2].e).toBe(events[3]);
  });
});

describe('summary and callNames', () => {
  it('counts calls per name and errors', () => {
    const tools = [
      use('1'),
      use('2'),
      use('3', 'Bash'),
      result('1', true),
      result('2'),
    ];
    expect(summary(tools)).toBe('3 tool calls: Read ×2, Bash · 1 error');
    expect(summary([use('1')])).toBe('1 tool call: Read');
    expect(summary([result('x')])).toBe('0 tool calls');
  });

  it('names calls with their count', () => {
    const calls = pairTools([use('1'), use('2'), use('3', 'Bash')]);
    expect(callNames(calls)).toBe('Read×2, Bash');
  });
});

describe('pairTools', () => {
  it('attaches a result to its call and keeps an orphan result alone', () => {
    const [read, orphan] = pairTools([
      use('1'),
      result('1', true),
      result('zzz'),
    ]);
    expect(read.result).toEqual({ preview: 'out 1', isError: true });
    expect(read.input).toBe('{"id":"1"}');
    expect(orphan).toMatchObject({ id: 'zzz', name: 'Result', input: '' });
  });
});

describe('subagents', () => {
  const events: ChatEvent[] = [
    use('a1', 'Agent'),
    use('s1', 'Read', 'a1'),
    use('a2', 'Agent', 'a1'),
    use('s2', 'Bash', 'a2'),
    result('s2', false, 'a2'),
    text('end'),
  ];

  it('splits master events (with absolute index) from subagent events by parent', () => {
    const { master, at, sub } = splitSubagents(events, 100);
    expect(master).toEqual([events[0], events[5]]);
    expect(at).toEqual([100, 105]);
    expect([...sub.keys()]).toEqual(['a1', 'a2']);
    expect(sub.get('a2')).toHaveLength(2);
  });

  it('counts and collects the subagent events under calls, nested ones included', () => {
    const { sub } = splitSubagents(events, 0);
    const calls = [events[0] as ToolEvent];
    expect(countSub(calls, sub)).toBe(4);
    expect([...subOf(calls, sub).keys()]).toEqual(['a1', 'a2']);
    expect(countSub([use('other')], sub)).toBe(0);
  });

  it('stops at a parent cycle', () => {
    const cyc = [use('x', 'Agent', 'y'), use('y', 'Agent', 'x')];
    const { sub } = splitSubagents(cyc, 0);
    expect(countSub([use('x', 'Agent')], sub)).toBe(2);
  });
});
