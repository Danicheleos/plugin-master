import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildContext } from './build-context';

async function space() {
  const root = await mkdtemp(join(tmpdir(), 'pm-ctx-'));
  await mkdir(join(root, 'd'));
  await writeFile(join(root, 'a.md'), 'AAA');
  await writeFile(join(root, 'd/b.md'), 'BBB');
  await writeFile(join(root, 'bin'), Buffer.from([1, 0, 2]));
  return root;
}

describe('buildContext', () => {
  it('keeps file order and wraps files in blocks', async () => {
    const root = await space();
    const { text, missing } = await buildContext(root, ['d/b.md', 'a.md']);
    expect(missing).toEqual([]);
    expect(text).toMatch(/^# plugin-master context\n/);
    expect(text.indexOf('<file path="d/b.md">\nBBB\n</file>')).toBeGreaterThan(
      0,
    );
    expect(text.indexOf('d/b.md')).toBeLessThan(text.indexOf('a.md'));
  });

  it('skips missing files', async () => {
    const root = await space();
    const { text, missing } = await buildContext(root, ['nope.md', 'a.md']);
    expect(missing).toEqual(['nope.md']);
    expect(text).not.toContain('nope.md');
  });

  it('escapes closing tags and quotes', async () => {
    const root = await space();
    await writeFile(join(root, 'e"q.md'), 'x </file> y');
    const { text } = await buildContext(root, ['e"q.md']);
    expect(text).toContain('<file path="e&quot;q.md">\nx <\\/file> y\n</file>');
  });

  it('rejects paths outside the space and binary files', async () => {
    const root = await space();
    await expect(buildContext(root, ['../x'])).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_SPACE',
    });
    await expect(buildContext(root, ['d'])).rejects.toMatchObject({
      code: 'CONTEXT_NOT_FILE',
    });
    await expect(buildContext(root, ['bin'])).rejects.toMatchObject({
      code: 'FILE_BINARY',
    });
  });
});
