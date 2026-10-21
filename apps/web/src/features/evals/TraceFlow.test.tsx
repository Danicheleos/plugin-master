import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Trace, TraceToolUse, TraceTurn } from '@pm/protocol';
import { describe, expect, it } from 'vitest';
import { TraceFlow } from './TraceFlow';

const tool = (id: string, name: string, input: object, isError = false, turns?: TraceTurn[]): TraceToolUse => ({
  id,
  name,
  input: JSON.stringify(input),
  result: { preview: isError ? 'boom' : 'ok', isError },
  turns,
});
const turn = (id: string, tools: TraceToolUse[], text?: string): TraceTurn => ({
  id,
  context: 1000,
  outputTokens: 10,
  text,
  tools,
});

const trace: Trace = {
  prompt: 'Make a skill',
  metrics: {
    modelCalls: 3, subagentModelCalls: 1, toolCalls: {}, toolCallsTotal: 10, toolErrors: 1, subagents: [],
    maxContext: 1000, finalContext: 1000, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    cacheCreationTokens: 0, numTurns: 3, costUsd: 0.5, durationMs: 4000, permissionDenials: 1, badLines: 0,
  },
  turns: [
    turn('a', [tool('s', 'Skill', { skill: 'my-skill' })], 'I will use the skill'),
    turn('b', [
      ...[1, 2, 3, 4, 5, 6].map((n) => tool(`r${n}`, 'Read', { file_path: `/f${n}.md` })),
      tool('w', 'Write', { file_path: '/out.md' }),
      tool('t', 'Task', { description: 'Helper job' }, false, [
        turn('n1', [tool('nb', 'Bash', { command: 'echo nested' }, true)]),
      ]),
    ]),
  ],
};

describe('TraceFlow', () => {
  it('renders prompt, skill, collapsed reads, edit, subagent lane, error and result', () => {
    render(
      <MantineProvider>
        <TraceFlow trace={trace} />
      </MantineProvider>,
    );
    expect(screen.getByText('Make a skill')).toBeTruthy();
    expect(screen.getByText('skill fired: my-skill')).toBeTruthy();
    expect(screen.getByText('6 reads')).toBeTruthy();
    expect(screen.queryByText('/f1.md')).toBeNull();
    fireEvent.click(screen.getAllByText('show')[0] as HTMLElement);
    expect(screen.getByText('/f1.md')).toBeTruthy();
    expect(screen.getByText('/out.md')).toBeTruthy();
    expect(screen.getByText('Helper job')).toBeTruthy();
    expect(screen.getByText('echo nested')).toBeTruthy();
    expect(screen.getByText('error')).toBeTruthy();
    expect(screen.getByText('1 tool errors', { exact: false })).toBeTruthy();
    expect(screen.getByText('1 permission denials', { exact: false })).toBeTruthy();
  });

  it('expands a long model text in place', () => {
    const long = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
    render(
      <MantineProvider>
        <TraceFlow trace={{ ...trace, prompt: undefined, turns: [turn('x', [], long)] }} />
      </MantineProvider>,
    );
    const clamped = { selector: '[data-line-clamp="true"]' };
    expect(screen.getByText(/line 0/, clamped)).toBeTruthy();
    fireEvent.click(screen.getByText('show full'));
    expect(screen.queryByText(/line 0/, clamped)).toBeNull();
    expect(screen.getByText('show less')).toBeTruthy();
  });
});

describe('TraceFlow preamble', () => {
  it('folds the system prompt and the pre-turn context until opened', () => {
    render(
      <MantineProvider>
        <TraceFlow trace={{ ...trace, preamble: { system: 'SYSTEM TEXT', items: [{ kind: 'skill_listing', text: 'LISTING' }] } }} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByText(/System prompt/));
    expect(screen.getByText('SYSTEM TEXT')).toBeTruthy();
    fireEvent.click(screen.getByText(/Context before the first turn/));
    fireEvent.click(screen.getByText(/skill_listing/));
    expect(screen.getByText('LISTING')).toBeTruthy();
  });
});
