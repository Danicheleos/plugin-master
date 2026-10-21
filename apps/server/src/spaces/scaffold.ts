import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
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

const IGNORE_ENTRY = '.plugin-master';

/** Adds `.plugin-master` to the space's .gitignore unless an equivalent line exists. */
async function ensureGitignore(dir: string): Promise<void> {
  const file = join(dir, '.gitignore');
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const covered = text
    .split(/\r?\n/)
    .some((l) =>
      [
        '.plugin-master',
        '.plugin-master/',
        '/.plugin-master',
        '/.plugin-master/',
      ].includes(l.trim()),
    );
  if (covered) return;
  const sep = text === '' || text.endsWith('\n') ? '' : '\n';
  await appendFile(file, `${sep}${IGNORE_ENTRY}\n`);
}

export async function scaffold(
  dir: string,
  o: { name: string; description: string },
): Promise<void> {
  await writeMissing(dir, {
    ...pluginFiles(o.name, o.description),
    ...pluginMasterFiles(),
  });
  await ensureGitignore(dir);
}

export async function ensurePluginMaster(dir: string): Promise<void> {
  await writeMissing(dir, pluginMasterFiles());
  await ensureGitignore(dir);
}
