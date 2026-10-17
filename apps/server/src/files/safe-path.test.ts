import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInSpace } from './safe-path';

describe('resolveInSpace', () => {
  it('resolves paths inside the root', () => {
    expect(resolveInSpace('/r', 'a/b.md')).toBe('/r/a/b.md');
    expect(resolveInSpace('/r', 'a/../b.md')).toBe('/r/b.md');
  });

  it.each(['../x', '/etc/passwd', 'a/../../x', '../r-evil/x'])(
    'rejects %s',
    (rel) => {
      expect(() => resolveInSpace('/r', rel)).toThrowError(
        expect.objectContaining({ code: 'PATH_OUTSIDE_SPACE', status: 400 }),
      );
    },
  );

  it('rejects a NUL byte in the path', () => {
    expect(() => resolveInSpace('/r', 'a\0b')).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('rejects symlinks that lead outside the root, even for new files', () => {
    const base = mkdtempSync(join(tmpdir(), 'pm-sym-'));
    const root = join(base, 'root');
    mkdirSync(root);
    mkdirSync(join(base, 'outside'));
    writeFileSync(join(base, 'outside/secret.txt'), 's');
    symlinkSync(join(base, 'outside/secret.txt'), join(root, 'link.txt'));
    symlinkSync(join(base, 'outside'), join(root, 'linkdir'));
    symlinkSync(join(base, 'outside/nope.txt'), join(root, 'dangling.txt'));
    mkdirSync(join(root, 'real'));
    symlinkSync(join(root, 'real'), join(root, 'inner'));
    for (const rel of [
      'link.txt',
      'linkdir/secret.txt',
      'linkdir/x/y.txt',
      'dangling.txt',
    ])
      expect(() => resolveInSpace(root, rel)).toThrowError(
        expect.objectContaining({ code: 'PATH_OUTSIDE_SPACE' }),
      );
    expect(resolveInSpace(root, 'inner/a.md')).toBe(join(root, 'inner/a.md'));
  });
});
