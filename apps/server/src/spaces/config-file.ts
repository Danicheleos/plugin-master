import { readFile, writeFile } from 'node:fs/promises';
import { SpaceConfigSchema, type SpaceConfig } from '@pm/protocol';
import { resolveInSpace } from '../files/safe-path';

const CONFIG_JSON = '.plugin-master/config.json';

const locks = new Map<string, Promise<unknown>>();

/** Runs `fn` after earlier calls for the same space root, so read-modify-write cycles do not interleave. */
export function withLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(root) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(root, tail);
  void tail.then(() => locks.get(root) === tail && locks.delete(root));
  return run;
}

/** Missing file = defaults. */
export async function readConfig(root: string): Promise<SpaceConfig> {
  try {
    const raw = await readFile(resolveInSpace(root, CONFIG_JSON), 'utf8');
    return SpaceConfigSchema.parse(JSON.parse(raw));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
      return SpaceConfigSchema.parse({ masterContext: [] });
    throw e;
  }
}

export const writeConfig = (root: string, config: SpaceConfig) =>
  writeFile(
    resolveInSpace(root, CONFIG_JSON),
    JSON.stringify(config, null, 2) + '\n',
  );
