import type { Trace, TraceTurn } from '@pm/protocol';
import { expect, it } from 'vitest';
import { subagentTrace } from './subagent-trace';

const turn = (
  id: string,
  context: number,
  tools: TraceTurn['tools'] = [],
): TraceTurn => ({
  id,
  context,
  outputTokens: 10,
  tools,
});

const metrics = {
  modelCalls: 1,
  subagentModelCalls: 2,
  toolCalls: {},
  toolCallsTotal: 0,
  toolErrors: 0,
  subagents: [{ toolUseId: 'a1', durationMs: 1234 }],
  maxContext: 0,
  finalContext: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  permissionDenials: 0,
  badLines: 0,
};

const trace: Trace = {
  metrics,
  turns: [
    turn('m1', 100, [
      {
        id: 'a1',
        name: 'Agent',
        input: JSON.stringify({ prompt: 'find it' }),
        turns: [
          turn('s1', 500, [
            {
              id: 'r1',
              name: 'Read',
              input: '{}',
              result: { preview: '', isError: true },
            },
          ]),
          turn('s2', 800),
        ],
      },
    ]),
  ],
};

it('keeps only the subagent: its turns, prompt and metrics', () => {
  const t = subagentTrace(trace, 'a1');
  expect(t?.turns.map((x) => x.id)).toEqual(['s1', 's2']);
  expect(t?.prompt).toBe('find it');
  expect(t?.metrics).toMatchObject({
    modelCalls: 2,
    toolCalls: { Read: 1 },
    toolErrors: 1,
    maxContext: 800,
    finalContext: 800,
    outputTokens: 20,
    durationMs: 1234,
  });
});

it('is undefined while the call is not in the trace', () => {
  expect(subagentTrace(trace, 'nope')).toBeUndefined();
});
