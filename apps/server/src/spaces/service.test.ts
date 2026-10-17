import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRegistry } from './registry';
import { createSpacesService } from './service';

let root: string;
let service: ReturnType<typeof createSpacesService>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pm-service-'));
  service = createSpacesService(createRegistry(join(root, 'home')));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('spaces service', () => {
  it('create scaffolds the folder and rejects a duplicate path', async () => {
    const path = join(root, 'new', 'plugin');
    const space = await service.create({ path, name: 'plug', description: '' });
    expect(space.path).toBe(path);
    await expect(
      readFile(join(path, '.claude-plugin/plugin.json')),
    ).resolves.toBeDefined();
    await expect(
      service.create({ path, name: 'plug', description: '' }),
    ).rejects.toMatchObject({ code: 'SPACE_EXISTS', status: 409 });
  });

  it('create rejects a relative path', async () => {
    await expect(
      service.create({ path: 'rel', name: 'p', description: '' }),
    ).rejects.toMatchObject({ code: 'PATH_NOT_ABSOLUTE' });
  });

  it('open rejects a relative path and a malformed plugin.json', async () => {
    await expect(service.open({ path: 'rel' })).rejects.toMatchObject({
      code: 'PATH_NOT_ABSOLUTE',
    });
    const path = join(root, 'bad');
    await mkdir(join(path, '.claude-plugin'), { recursive: true });
    await writeFile(join(path, '.claude-plugin/plugin.json'), '{oops');
    await expect(service.open({ path })).rejects.toMatchObject({
      code: 'NOT_A_PLUGIN',
      status: 422,
    });
  });

  it('open fails with PATH_NOT_FOUND for a missing folder', async () => {
    await expect(
      service.open({ path: join(root, 'nope') }),
    ).rejects.toMatchObject({ code: 'PATH_NOT_FOUND', status: 404 });
  });

  it('open fails with NOT_A_PLUGIN for a folder without plugin.json', async () => {
    await expect(service.open({ path: root })).rejects.toMatchObject({
      code: 'NOT_A_PLUGIN',
      status: 422,
    });
  });

  it('open registers an existing plugin once and adds .plugin-master', async () => {
    const path = join(root, 'existing');
    await mkdir(join(path, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(path, '.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'existing-plugin' }),
    );
    const first = await service.open({ path });
    expect(first.name).toBe('existing-plugin');
    expect(await service.open({ path })).toEqual(first);
    expect(await service.list()).toHaveLength(1);
    expect((await service.getConfig(first.id)).masterContext).toHaveLength(2);
  });

  it('setConfig persists and remove only unregisters', async () => {
    const path = join(root, 'p');
    const space = await service.create({ path, name: 'p', description: '' });
    await service.setConfig(space.id, { masterContext: ['x.md'] });
    expect(await service.getConfig(space.id)).toEqual({
      masterContext: ['x.md'],
    });
    await expect(
      service.setConfig(space.id, { masterContext: ['../x'] }),
    ).rejects.toMatchObject({ code: 'INVALID_CONTEXT_PATH' });
    await rm(join(path, '.plugin-master/config.json'));
    expect(await service.getConfig(space.id)).toEqual({ masterContext: [] });
    await service.remove(space.id);
    expect(await service.list()).toEqual([]);
    await expect(readFile(join(path, 'CLAUDE.md'))).resolves.toBeDefined();
  });
});
