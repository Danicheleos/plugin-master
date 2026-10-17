import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pluginFiles, pluginMasterFiles } from './templates';

/** Creates only the missing files; never overwrites. */
async function writeMissing(
  dir: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    try {
      await writeFile(abs, content, { flag: 'wx' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
}

export function scaffold(
  dir: string,
  o: { name: string; description: string },
): Promise<void> {
  return writeMissing(dir, {
    ...pluginFiles(o.name, o.description),
    ...pluginMasterFiles(),
  });
}

export function ensurePluginMaster(dir: string): Promise<void> {
  return writeMissing(dir, pluginMasterFiles());
}
