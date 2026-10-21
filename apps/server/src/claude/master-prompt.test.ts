import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { DEFAULT_MASTER_PROMPT, MASTER_PROMPT_FILE, loadMasterPrompt } from './master-prompt';

it('creates MASTER.md from the default and then uses the user-edited file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pm-prompt-'));
  expect(await loadMasterPrompt(root)).toBe(DEFAULT_MASTER_PROMPT);
  expect(await readFile(join(root, MASTER_PROMPT_FILE), 'utf8')).toContain('# Role');
  await writeFile(join(root, MASTER_PROMPT_FILE), 'custom');
  expect(await loadMasterPrompt(root)).toBe('custom');
});
