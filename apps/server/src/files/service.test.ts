import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { create, read, tree, write } from './service';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pm-files-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('files service', () => {
  it('tree lists one level, ignores .git/node_modules, puts dirs first', async () => {
    await mkdir(join(root, 'b/sub'), { recursive: true });
    await mkdir(join(root, '.git'));
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'a.md'), '');
    await writeFile(join(root, 'b/sub/c.md'), '');
    expect(await tree(root)).toEqual([
      { name: 'b', path: 'b', type: 'dir' },
      { name: 'a.md', path: 'a.md', type: 'file' },
    ]);
    expect(await tree(root, 'b')).toEqual([
      { name: 'sub', path: 'b/sub', type: 'dir' },
    ]);
    expect(await tree(root, 'b/sub')).toEqual([
      { name: 'c.md', path: 'b/sub/c.md', type: 'file' },
    ]);
  });

  it('tree rejects dirs outside the space and missing dirs', async () => {
    await expect(tree(root, '../x')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_SPACE',
    });
    await expect(tree(root, 'nope')).rejects.toMatchObject({ status: 404 });
  });

  it('create makes parent dirs and refuses to overwrite', async () => {
    await create(root, 'skills/foo/SKILL.md', 'hi');
    expect(await readFile(join(root, 'skills/foo/SKILL.md'), 'utf8')).toBe(
      'hi',
    );
    await expect(create(root, 'skills/foo/SKILL.md')).rejects.toMatchObject({
      code: 'FILE_EXISTS',
      status: 409,
    });
  });

  it('write replaces an existing file fully and 404s on a missing one', async () => {
    await writeFile(join(root, 'a.md'), 'long content');
    await write(root, 'a.md', 'short');
    expect(await read(root, 'a.md')).toEqual({
      path: 'a.md',
      content: 'short',
    });
    await expect(write(root, 'nope.md', 'x')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('read rejects binary files with 415 and missing files with 404', async () => {
    await writeFile(join(root, 'b.bin'), Buffer.from([1, 0, 2]));
    await expect(read(root, 'b.bin')).rejects.toMatchObject({
      code: 'BINARY_FILE',
      status: 415,
    });
    await expect(read(root, 'nope')).rejects.toMatchObject({ status: 404 });
  });
});
