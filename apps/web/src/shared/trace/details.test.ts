import { describe, expect, it } from 'vitest';
import { parseDetail } from './details';

describe('parseDetail', () => {
  it('keeps plain text and unparsable JSON as is', () => {
    expect(parseDetail('hello\nworld')).toEqual({
      kind: 'text',
      text: 'hello\nworld',
    });
    expect(parseDetail('{"a": 1, "b": "cut…')).toEqual({
      kind: 'text',
      text: '{"a": 1, "b": "cut…',
    });
    expect(parseDetail('42')).toEqual({ kind: 'text', text: '42' });
  });

  it('parses objects and arrays into structure', () => {
    expect(parseDetail('{"file_path":"/a.md","n":2}')).toEqual({
      kind: 'json',
      value: { file_path: '/a.md', n: 2 },
    });
    expect(parseDetail(' [1, {"x": null}] ')).toEqual({
      kind: 'json',
      value: [1, { x: null }],
    });
  });

  it('decodes JSON-encoded strings, also when they hold JSON', () => {
    expect(parseDetail('"line 1\\nline 2"')).toEqual({
      kind: 'text',
      text: 'line 1\nline 2',
    });
    expect(parseDetail(JSON.stringify(JSON.stringify({ a: 1 })))).toEqual({
      kind: 'json',
      value: { a: 1 },
    });
  });

  it('turns content blocks into text parts and labels', () => {
    const blocks = [
      { type: 'text', text: 'first\nsecond' },
      { type: 'image', source: {} },
    ];
    expect(parseDetail(JSON.stringify(blocks))).toEqual({
      kind: 'blocks',
      parts: [{ text: 'first\nsecond' }, { label: 'image' }],
    });
  });
});
