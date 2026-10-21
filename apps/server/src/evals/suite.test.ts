import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSuite } from './suite';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pm-suite-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const put = async (rel: string, content: string) => {
  await mkdir(join(root, rel, '..'), { recursive: true });
  await writeFile(join(root, rel), content);
};

describe('readSuite', () => {
  it('is empty without an eval dir', async () => {
    expect(await readSuite(root)).toEqual({ cases: [], tags: [] });
  });

  it('reads prompt.md frontmatter, case.yaml and nested groups; skips results, mocks and dot dirs', async () => {
    await put('evals/a/prompt.md', '---\nname: alpha\ndescription: first\ntags: [smoke, x]\n---\nHi');
    await put('evals/b/prompt.md', 'no frontmatter');
    await put('evals/grp/c/case.yaml', 'schema_version: "1.1"\nname: gamma\ntags: [smoke]\n');
    await put('evals/d/case.yaml', 'name: from-yaml\ntags: [y]\n');
    await put('evals/d/prompt.md', '---\ntags: [z]\n---\nbody');
    await put('evals/results/r/prompt.md', '---\nname: no\n---');
    await put('evals/mocks/s/prompt.md', '---\nname: no\n---');
    await put('evals/.hidden/prompt.md', '---\nname: no\n---');
    const suite = await readSuite(root);
    expect(suite.cases.map((c) => [c.name, c.dir, c.tags])).toEqual([
      ['alpha', 'evals/a', ['smoke', 'x']],
      ['b', 'evals/b', []],
      ['from-yaml', 'evals/d', ['z']],
      ['gamma', 'evals/grp/c', ['smoke']],
    ]);
    expect(suite.cases[0].description).toBe('first');
    expect(suite.tags).toEqual(['smoke', 'x', 'z']);
  });

  it('lists a broken case with an error and uses the eval dir from plugin.json', async () => {
    await put('.claude-plugin/plugin.json', '{"experimental":{"evals":"qa"}}');
    await put('qa/bad/prompt.md', '---\nname: [unclosed\n---\nx');
    const { cases } = await readSuite(root);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ name: 'bad', dir: 'qa/bad' });
    expect(cases[0].error).toBeTruthy();
  });
});
