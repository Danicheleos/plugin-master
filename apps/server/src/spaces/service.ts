import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import {
  type CreateSpace,
  type OpenSpace,
  type Space,
  type SpaceConfig,
  type SpaceConfigInput,
} from '@pm/protocol';
import { resolveInSpace } from '../files/safe-path';
import { AppError } from '../lib/errors';
import type { Registry } from './registry';
import { readConfig, withLock, writeConfig } from './config-file';
import { ensurePluginMaster, scaffold } from './scaffold';

const PLUGIN_JSON = '.claude-plugin/plugin.json';

function requireAbsolute(path: string): string {
  if (!isAbsolute(path))
    throw new AppError('PATH_NOT_ABSOLUTE', 'Path must be absolute', 400);
  return resolve(path);
}

export function createSpacesService(registry: Registry) {
  async function findByPath(path: string): Promise<Space | undefined> {
    return (await registry.list()).find((s) => s.path === path);
  }

  return {
    list: () => registry.list(),

    async create(input: CreateSpace): Promise<Space> {
      const path = requireAbsolute(input.path);
      if (await findByPath(path))
        throw new AppError('SPACE_EXISTS', 'Space already exists', 409);
      await mkdir(path, { recursive: true });
      await scaffold(path, input);
      const space = {
        id: randomUUID(),
        name: input.name,
        path,
        createdAt: new Date().toISOString(),
      };
      await registry.add(space);
      return space;
    },

    async open(input: OpenSpace): Promise<Space> {
      const path = requireAbsolute(input.path);
      const isDir = await stat(path).then(
        (s) => s.isDirectory(),
        () => false,
      );
      if (!isDir)
        throw new AppError('PATH_NOT_FOUND', 'Folder does not exist', 404);
      const pluginJson = await readFile(join(path, PLUGIN_JSON), 'utf8').catch(
        () => undefined,
      );
      if (pluginJson === undefined)
        throw new AppError('NOT_A_PLUGIN', `${PLUGIN_JSON} not found`, 422);
      let name: unknown;
      try {
        name = (JSON.parse(pluginJson) as { name?: unknown }).name;
      } catch {
        throw new AppError(
          'NOT_A_PLUGIN',
          `${PLUGIN_JSON} is not valid JSON`,
          422,
        );
      }
      const existing = await findByPath(path);
      if (existing) return existing;
      await ensurePluginMaster(path);
      const space = {
        id: randomUUID(),
        name: typeof name === 'string' ? name : basename(path),
        path,
        createdAt: new Date().toISOString(),
      };
      await registry.add(space);
      return space;
    },

    remove: (id: string) => registry.remove(id),

    async getConfig(id: string): Promise<SpaceConfig> {
      return readConfig((await registry.get(id)).path);
    },

    /** Replaces masterContext; `activePlan` is kept (it changes through the plans API). */
    async setConfig(id: string, input: SpaceConfigInput): Promise<SpaceConfig> {
      const { path } = await registry.get(id);
      for (const entry of input.masterContext) {
        try {
          resolveInSpace(path, entry);
        } catch {
          throw new AppError(
            'INVALID_CONTEXT_PATH',
            `masterContext entry "${entry}" is outside the space`,
            400,
          );
        }
      }
      return withLock(path, async () => {
        const config = { ...(await readConfig(path)), ...input };
        await writeConfig(path, config);
        return config;
      });
    },
  };
}

export type SpacesService = ReturnType<typeof createSpacesService>;
