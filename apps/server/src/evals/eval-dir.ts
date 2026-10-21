import { readFile } from 'node:fs/promises';
import { resolveInSpace } from '../files/safe-path';

/** Name of the result file in every run dir. */
export const RESULT_FILE = 'aggregate-result.json';

type Manifest = { name?: unknown; experimental?: { evals?: unknown } };

/** `.claude-plugin/plugin.json`; `{}` when missing or broken. */
async function manifest(root: string): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(resolveInSpace(root, '.claude-plugin/plugin.json'), 'utf8')) as Manifest;
  } catch {
    return {};
  }
}

/** Eval dir relative to the space root: `plugin.json` `experimental.evals`, else `evals`. */
export async function evalDir(root: string): Promise<string> {
  const dir = (await manifest(root)).experimental?.evals;
  if (typeof dir === 'string' && dir) {
    try {
      resolveInSpace(root, dir);
      return dir.replace(/^\.\//, '').replace(/\/$/, '');
    } catch {
      // outside the space: default
    }
  }
  return 'evals';
}

/** `name` of `.claude-plugin/plugin.json`, if any. */
export async function pluginName(root: string): Promise<string | undefined> {
  const { name } = await manifest(root);
  return typeof name === 'string' ? name : undefined;
}
