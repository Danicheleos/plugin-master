import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MASTER_PROMPT, MASTER_PROMPT_FILE, loadMasterPrompt } from './master-prompt';

it('creates MASTER.md from the default and then uses the user-edited file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pm-prompt-'));
  expect(await loadMasterPrompt(root)).toBe(DEFAULT_MASTER_PROMPT);
  expect(await readFile(join(root, MASTER_PROMPT_FILE), 'utf8')).toContain('# Role');
  await writeFile(join(root, MASTER_PROMPT_FILE), 'custom');
  expect(await loadMasterPrompt(root)).toBe('custom');
});

describe('default master prompt', () => {
  const p = DEFAULT_MASTER_PROMPT;

  it('is universal: no repository- or product-specific terms, no Cyrillic', () => {
    expect(p).not.toMatch(/ambicode|npm run|pnpm|K12|evals:bare|navigator|inseer|[а-яё]/i);
  });

  it('replaces the pinned copies after compaction instead of forbidding a re-read', () => {
    expect(p).not.toMatch(/do not read them again/i);
    expect(p).toMatch(/from session start and go stale/);
    expect(p).toMatch(/After a compaction[^\n]*summary may have dropped rules[^\n]*injected copies and the agent roster/);
  });

  it('keeps STATE to the current state and history in LOG, replaced by area', () => {
    expect(p).toMatch(/no run stamps, no commit lists, no per-run costs[^\n]*Those go to LOG/);
    expect(p).toMatch(/replacing its line, after reading the whole file/);
    expect(p).toMatch(/under ~100 lines[^\n]*move history to LOG in the same turn/);
    expect(p).not.toMatch(/after every finished phase/i);
  });

  it('makes analysis requests read-only, complaints material, not orders', () => {
    expect(p).toMatch(/analyse, audit, explain or answer a question changes nothing[^\n]*including STATE, LOG, RULES and memory/);
    expect(p).toMatch(/complaint or a listed defect is material for the analysis, not an order to fix/);
  });

  it('sends durable user remarks to RULES.md, never auto memory', () => {
    expect(p).toMatch(/durable remarks[^\n]*append it there in the same turn\. Never put it in Claude's auto memory/);
  });

  it('names the presets and the resume rule', () => {
    expect(p).toMatch(/`reader`[^\n]*`writer`[^\n]*`runner`/);
    expect(p).toMatch(/Resume an agent \(SendMessage\)[^\n]*under 130k/);
  });

  it('asks for whole-run analysis, not one hypothesis, and a paid run only when traces cannot answer', () => {
    expect(p).not.toMatch(/one hypothesis/i);
    expect(p).toMatch(/every failing grader with its reason, every step of the trace/);
    expect(p).toMatch(/What else could affect this, and was it checked\?/);
    expect(p).toMatch(/new paid run only when the traces cannot answer/);
  });

  it('requires change briefs to cover the mechanism, sibling texts and cut text', () => {
    expect(p).toMatch(/read the mechanism the change touches[^\n]*grep every other text and code[^\n]*what was cut to fit a size cap/);
  });

  it('requires the two closing sections and their relay', () => {
    expect(p).toMatch(/ends with two sections: "Seen on the way:"[^\n]*"Not verified:"/);
    expect(p).toMatch(/Relay every "Seen on the way" item to the user once and log it in LOG/);
  });

  it('asks before paid runs with an estimate and compares with the bare baseline only', () => {
    expect(p).toMatch(/Ask the user before each run[^\n]*estimated cost/);
    expect(p).toMatch(/against the bare baseline[^\n]*"Baseline" means the bare arm only/);
  });

  it('forbids case fitting and non-generic tuning', () => {
    expect(p).toMatch(/never edit seeds, graders or truth to match a run/);
    expect(p).toMatch(/Tuning is generic/);
  });

  it('leaves code-change rules to CLAUDE.md and release steps to the user', () => {
    expect(p).toMatch(/CLAUDE\.md[^\n]*owns how code and texts are changed[^\n]*Do not restate it/);
    expect(p).toMatch(/Bump the version, package or squash only on the user's command/);
  });
});
