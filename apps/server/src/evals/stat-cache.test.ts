import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { byStat, resetStatCache } from './stat-cache';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pm-statcache-'));
  resetStatCache();
});
afterEach(() => rm(dir, { recursive: true, force: true }));

it('reuses a value until the file changes', async () => {
  const file = join(dir, 'a.json');
  await writeFile(file, '1');
  const compute = vi.fn(async () => 'v');
  await byStat(file, 'k', compute);
  await byStat(file, 'k', compute);
  expect(compute).toHaveBeenCalledTimes(1);
  await writeFile(file, '22');
  await byStat(file, 'k', compute);
  expect(compute).toHaveBeenCalledTimes(2);
  await utimes(file, new Date(), new Date(Date.now() + 5000)); // same size, new mtime
  await byStat(file, 'k', compute);
  expect(compute).toHaveBeenCalledTimes(3);
});

it('keeps values of different kinds apart and does not cache failures', async () => {
  const file = join(dir, 'a.json');
  await writeFile(file, '1');
  expect(await byStat(file, 'a', async () => 1)).toBe(1);
  expect(await byStat(file, 'b', async () => 2)).toBe(2);
  await expect(
    byStat(file, 'c', async () => {
      throw new Error('bad');
    }),
  ).rejects.toThrow('bad');
  expect(await byStat(file, 'c', async () => 3)).toBe(3);
});

it('rejects for a missing file', async () => {
  await expect(byStat(join(dir, 'nope'), 'k', async () => 1)).rejects.toThrow();
});
