import { describe, expect, it } from 'vitest';
import { finalText, foundPaths, retrievalOf, scoreFiles, TruthSchema } from './retrieval';

const truth = TruthSchema.parse({ relevant: ['a/x.ts', 'b/'], allowed: ['c/y.ts'] });
const trace = (text: string) =>
  [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'draft' }] } }),
    JSON.stringify({ type: 'assistant', parent_tool_use_id: 't', message: { content: [{ type: 'text', text: 'sub' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
  ].join('\n');

describe('retrieval metrics', () => {
  it('takes the last main-session text', () => {
    expect(finalText(trace('final'))).toBe('final');
  });

  it('scores the files block: directory items are hit by a file inside, allowed files are neutral', () => {
    const t = trace('```files\na/x.ts\nb/z.ts\nc/y.ts\nd/w.ts\n```');
    expect(foundPaths(finalText(t), 'files-block')).toEqual(['a/x.ts', 'b/z.ts', 'c/y.ts', 'd/w.ts']);
    expect(retrievalOf(truth, t)).toEqual({ recall: 1, precision: 0.75, f1: 0.857 });
  });

  it('a missing block breaks the contract: recall and F1 0, precision null', () => {
    expect(retrievalOf(truth, trace('no list'))).toEqual({ recall: 0, precision: null, f1: 0 });
    expect(scoreFiles(truth, [])).toEqual({ recall: 0, precision: null, f1: 0 });
  });
});
