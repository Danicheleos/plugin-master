import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadToken } from './token';

const DAY = 24 * 60 * 60 * 1000;
const home = () => mkdtempSync(join(tmpdir(), 'pm-token-'));

describe('loadToken', () => {
  it('reuses the saved token until it expires, then rotates', () => {
    const dir = home();
    const first = loadToken(dir, 7, 0);
    expect(loadToken(dir, 7, 6 * DAY)).toBe(first);
    const rotated = loadToken(dir, 7, 7 * DAY);
    expect(rotated).not.toBe(first);
    expect(loadToken(dir, 7, 8 * DAY)).toBe(rotated);
  });

  it('stores the token readable by the owner only', () => {
    const dir = home();
    loadToken(dir, 7);
    expect(statSync(join(dir, 'token.json')).mode & 0o077).toBe(0);
  });

  it('replaces a broken token file', () => {
    const dir = home();
    writeFileSync(join(dir, 'token.json'), '{oops');
    expect(loadToken(dir, 7)).toHaveLength(32);
  });
});
