import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readSessionTrace } from './transcript';

const dir = join(__dirname, '__fixtures__', 'transcript');
const projects = join(dir, 'projects');
const ID = '11111111-2222-3333-4444-555555555555';

it('joins the transcript, its subagents and the recorded run into one trace', async () => {
  const trace = await readSessionTrace(
    ID,
    join(dir, 'run', 'messages.jsonl'),
    projects,
  );
  expect(trace?.preamble?.system).toContain('You are the master.');
  expect(trace?.preamble?.items.map((i) => i.kind)).toContain(
    'hook_additional_context',
  );
  expect(trace?.prompt).toBe('look at the skill');
  expect(trace?.turns.map((t) => t.id)).toEqual(['m1', 'm2']);
  const agent = trace?.turns[0].tools[0];
  expect(agent?.result?.preview).toBe('it is short');
  expect(agent?.turns?.map((t) => t.id)).toEqual(['s1', 's2']);
  expect(agent?.turns?.[0].tools[0].result?.preview).toBe('# x');
  expect(trace?.metrics.subagents).toEqual([
    {
      toolUseId: 'toolu_A',
      description: 'Read skill',
      subagentType: 'reader',
      status: 'completed',
    },
  ]);
  expect(trace?.metrics).toMatchObject({
    costUsd: 0.42,
    durationMs: 1234,
    numTurns: 2,
    modelCalls: 2,
    subagentModelCalls: 2,
  });
});

it('has no trace without a transcript or with an id that is not a session id', async () => {
  expect(
    await readSessionTrace(
      '22222222-2222-3333-4444-555555555555',
      undefined,
      projects,
    ),
  ).toBeUndefined();
  expect(await readSessionTrace('../x', undefined, projects)).toBeUndefined();
  const bare = await readSessionTrace(ID, undefined, projects);
  expect(bare?.metrics.costUsd).toBeUndefined();
});

const jsonl = (ms: object[]) => ms.map((m) => JSON.stringify(m)).join('\n');
const turn = (id: string, input: number) => ({
  type: 'assistant',
  message: { id, content: [], usage: { input_tokens: input } },
});

it('folds every recorded result into one, puts the recorded preamble first and ignores subagent prompt snapshots', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pm-transcript-'));
  try {
    const project = join(tmp, 'projects', '-p');
    await mkdir(join(project, ID, 'subagents'), { recursive: true });
    await writeFile(
      join(project, `${ID}.jsonl`),
      jsonl([
        turn('m1', 10),
        {
          type: 'assistant',
          message: {
            id: 'm1',
            content: [{ type: 'tool_use', id: 'toolu_A', name: 'Agent' }],
            usage: { input_tokens: 10 },
          },
        },
        turn('m2', 20),
      ]),
    );
    const sub = join(project, ID, 'subagents', 'agent-a1');
    await writeFile(
      `${sub}.meta.json`,
      JSON.stringify({ toolUseId: 'toolu_A' }),
    );
    await writeFile(
      `${sub}.jsonl`,
      jsonl([
        {
          type: 'attachment',
          attachment: { type: 'prompt_snapshot', systemPrompt: 'sub prompt' },
        },
        turn('s1', 5),
      ]),
    );
    const run = join(tmp, 'run');
    await mkdir(run);
    const big = { input_tokens: 999999 };
    await writeFile(
      join(run, 'messages.jsonl'),
      jsonl([
        { type: 'system', subtype: 'init', tools: ['Read'], model: 'x' },
        {
          type: 'system',
          subtype: 'hook_response',
          hook_name: 'h',
          output: 'hi',
        },
        turn('m1', 10),
        {
          type: 'result',
          num_turns: 1,
          duration_ms: 100,
          total_cost_usd: 0.1,
          usage: big,
        },
        { type: 'system', subtype: 'init', model: 'x' },
        turn('m2', 20),
        {
          type: 'result',
          num_turns: 2,
          duration_ms: 200,
          total_cost_usd: 0.3,
          usage: big,
        },
      ]),
    );
    const read = () =>
      readSessionTrace(ID, join(run, 'messages.jsonl'), join(tmp, 'projects'));
    const trace = await read();
    expect(trace?.metrics).toMatchObject({
      numTurns: 3,
      durationMs: 300,
      costUsd: 0.3,
      inputTokens: 35,
      modelCalls: 2,
    });
    expect(trace?.preamble?.system).toBeUndefined();
    expect(trace?.preamble?.items.map((i) => i.kind)).toEqual([
      'init',
      'hook h',
    ]);
    await writeFile(join(run, 'meta.json'), JSON.stringify({ costUsd: 0.5 }));
    expect((await read())?.metrics.costUsd).toBe(0.5);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
