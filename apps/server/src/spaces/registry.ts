import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Space } from '@pm/protocol';
import { AppError } from '../lib/errors';

export function createRegistry(home: string) {
  const file = join(home, 'spaces.json');

  async function list(): Promise<Space[]> {
    try {
      return (JSON.parse(await readFile(file, 'utf8')) as { spaces: Space[] })
        .spaces;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  async function save(spaces: Space[]): Promise<void> {
    await mkdir(home, { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify({ spaces }, null, 2));
    await rename(tmp, file);
  }

  return {
    list,
    async get(id: string): Promise<Space> {
      const space = (await list()).find((s) => s.id === id);
      if (!space)
        throw new AppError('SPACE_NOT_FOUND', `Space ${id} not found`, 404);
      return space;
    },
    async add(space: Space): Promise<void> {
      await save([...(await list()), space]);
    },
    async remove(id: string): Promise<void> {
      await save((await list()).filter((s) => s.id !== id));
    },
  };
}

export type Registry = ReturnType<typeof createRegistry>;
