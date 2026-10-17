import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRegistry } from './registry';

const space = {
  id: 'a',
  name: 'p',
  path: '/p',
  createdAt: '2020-01-01T00:00:00.000Z',
};
let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pm-registry-'));
});
afterEach(() => rm(home, { recursive: true, force: true }));

describe('registry', () => {
  it('returns an empty list when spaces.json is missing', async () => {
    expect(await createRegistry(home).list()).toEqual([]);
  });

  it('adds, gets and removes spaces', async () => {
    const registry = createRegistry(home);
    await registry.add(space);
    expect(await registry.get('a')).toEqual(space);
    await registry.remove('a');
    expect(await registry.list()).toEqual([]);
  });

  it('throws SPACE_NOT_FOUND for an unknown id', async () => {
    await expect(createRegistry(home).get('nope')).rejects.toMatchObject({
      code: 'SPACE_NOT_FOUND',
      status: 404,
    });
  });
});
