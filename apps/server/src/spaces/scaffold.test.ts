import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensurePluginMaster, scaffold } from './scaffold';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pm-scaffold-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('scaffold', () => {
  it('creates the full structure in an empty folder', async () => {
    await scaffold(dir, { name: 'my-plugin', description: 'd' });
    const manifest = JSON.parse(
      await readFile(join(dir, '.claude-plugin/plugin.json'), 'utf8'),
    );
    expect(manifest).toEqual({
      name: 'my-plugin',
      version: '0.1.0',
      description: 'd',
    });
    for (const f of [
      'skills/.gitkeep',
      'CLAUDE.md',
      '.plugin-master/config.json',
      '.plugin-master/IDEA.md',
      '.plugin-master/STATE.md',
    ]) {
      await expect(readFile(join(dir, f))).resolves.toBeDefined();
    }
  });

  it('does not overwrite existing files', async () => {
    await scaffold(dir, { name: 'a', description: '' });
    await writeFile(join(dir, '.plugin-master/IDEA.md'), 'mine');
    await scaffold(dir, { name: 'a', description: '' });
    expect(await readFile(join(dir, '.plugin-master/IDEA.md'), 'utf8')).toBe(
      'mine',
    );
  });

  it('adds .plugin-master to .gitignore once, keeping existing lines', async () => {
    await writeFile(join(dir, '.gitignore'), 'node_modules');
    await ensurePluginMaster(dir);
    await ensurePluginMaster(dir);
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe(
      'node_modules\n.plugin-master\n',
    );
  });

  it('does not duplicate an existing .plugin-master/ entry', async () => {
    await writeFile(join(dir, '.gitignore'), '.plugin-master/\n');
    await scaffold(dir, { name: 'p', description: 'd' });
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe(
      '.plugin-master/\n',
    );
  });
});
