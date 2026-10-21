import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTrace } from './trace';

const fixture = readFileSync(join(__dirname, '__fixtures__/trace.jsonl'), 'utf8');

describe('parseTrace', () => {
  const { metrics, turns } = parseTrace(fixture);

  it('counts one model call per message id, not per entry', () => {
    expect(metrics.modelCalls).toBe(3);
    expect(metrics.subagentModelCalls).toBe(1);
    expect(turns.map((t) => t.id)).toEqual(['msg_1', 'msg_2', 'msg_3']);
  });

  it('computes the context of each call and its maximum', () => {
    expect(turns.map((t) => t.context)).toEqual([1002, 1103, 1104]);
    expect(metrics.maxContext).toBe(1104);
    expect(metrics.finalContext).toBe(1104);
    expect(turns[0]?.outputTokens).toBe(20);
  });

  it('merges text and thinking of split entries', () => {
    expect(turns[0]?.thinking).toBe('Plan the approach.');
    expect(turns[0]?.text).toBe('Looking around.');
  });

  it('counts tool calls by name including subagents, and matches results', () => {
    expect(metrics.toolCalls).toEqual({ Bash: 1, Task: 1, Read: 1 });
    expect(metrics.toolCallsTotal).toBe(3);
    expect(metrics.toolErrors).toBe(1);
    expect(turns[0]?.tools[0]?.result).toEqual({ preview: 'a.txt\nb.txt', isError: false });
  });

  it('nests subagent turns under the tool use and reads task messages', () => {
    const task = turns[1]?.tools[0];
    expect(task?.turns?.[0]?.tools[0]?.result).toEqual({ preview: 'no such file', isError: true });
    expect(metrics.subagents).toEqual([
      {
        toolUseId: 'toolu_b',
        description: 'Do it',
        subagentType: 'helper',
        status: 'completed',
        totalTokens: 600,
        toolUses: 1,
        durationMs: 1200,
      },
    ]);
  });

  it('reads init and result, counts bad lines', () => {
    expect(metrics).toMatchObject({
      model: 'test-model',
      numTurns: 3,
      costUsd: 0.05,
      durationMs: 4000,
      durationApiMs: 3000,
      permissionDenials: 1,
      inputTokens: 10,
      outputTokens: 71,
      cacheReadTokens: 2600,
      cacheCreationTokens: 1100,
      badLines: 1,
    });
  });

  it('truncates long inputs and results', () => {
    const big = 'x'.repeat(20_000);
    const line = (o: unknown) => JSON.stringify(o);
    const t = parseTrace(
      [
        line({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 't', name: 'Write', input: { content: big } }] } }),
        line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: big }] } }),
      ].join('\n'),
    );
    const tool = t.turns[0]?.tools[0];
    expect(tool?.input.length).toBeLessThanOrEqual(16_001);
    expect(tool?.result?.preview.length).toBeLessThanOrEqual(16_001);
  });

  it('falls back to summed usage without a result message', () => {
    const t = parseTrace(
      JSON.stringify({ type: 'assistant', message: { id: 'm', content: [], usage: { input_tokens: 5, output_tokens: 2 } } }),
    );
    expect(t.metrics).toMatchObject({ modelCalls: 1, inputTokens: 5, outputTokens: 2, costUsd: undefined });
  });

  it('keeps the first user text as the prompt, not tool results', () => {
    const line = (o: unknown) => JSON.stringify(o);
    const t = parseTrace(
      [
        line({ type: 'user', message: { content: [{ type: 'text', text: 'Do the thing' }] } }),
        line({ type: 'user', message: { content: 'later' } }),
      ].join('\n'),
    );
    expect(t.prompt).toBe('Do the thing');
    expect(parseTrace(fixture).prompt).toBeUndefined();
  });
});

describe('parseTrace preamble', () => {
  const lines = [
    { type: 'system', subtype: 'init', model: 'm', tools: ['Read'], session_id: 's' },
    { type: 'system', subtype: 'hook_response', hook_name: 'SessionStart:startup', output: 'extra context' },
    { type: 'attachment', attachment: { type: 'skill_listing', content: '- a: does a' } },
    { type: 'attachment', attachment: { type: 'prompt_snapshot', systemPrompt: ['SYS 1', 'SYS 2'] } },
    { type: 'user', message: { content: 'do it' } },
    { type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: 'ok' }], usage: {} } },
    { type: 'attachment', attachment: { type: 'date', date: 'late' } },
  ].map((l) => JSON.stringify(l)).join('\n');

  it('collects the system prompt and everything before the first model call', () => {
    const { preamble } = parseTrace(lines);
    expect(preamble?.system).toBe('SYS 1\n\n---\n\nSYS 2');
    expect(preamble?.items.map((i) => i.kind)).toEqual(['init', 'hook SessionStart:startup', 'skill_listing', 'user']);
    expect(preamble?.items[0]?.text).toContain('"model": "m"');
  });

  it('has no preamble when the trace starts at the first call', () => {
    expect(parseTrace(JSON.stringify({ type: 'assistant', message: { id: 'a', content: [], usage: {} } })).preamble).toBeUndefined();
  });
});
