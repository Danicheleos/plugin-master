import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { FileContent, FileNode } from '@pm/protocol';
import { AppError } from '../lib/errors';
import { resolveInSpace } from './safe-path';

export const IGNORED = ['.git', 'node_modules', '.DS_Store'];

const notFound = () => new AppError('FILE_NOT_FOUND', 'File not found', 404);

/** One directory level (`dir` relative to the root, '' = root); subdirectories are loaded on demand. */
export async function tree(root: string, dir = ''): Promise<FileNode[]> {
  const absDir = resolveInSpace(root, dir);
  const entries = await readdir(absDir, { withFileTypes: true }).catch(
    (e: unknown) => {
      const code = (e as NodeJS.ErrnoException).code;
      throw code === 'ENOENT' || code === 'ENOTDIR' ? notFound() : e;
    },
  );
  const nodes = await Promise.all(
    entries
      .filter((e) => !IGNORED.includes(e.name))
      .map(async (e): Promise<FileNode | undefined> => {
        const abs = join(absDir, e.name);
        const path = relative(root, abs).split(sep).join('/');
        if (e.isSymbolicLink()) {
          // shown only if it stays inside the space and resolves
          try {
            resolveInSpace(root, path);
            const isDir = (await stat(abs)).isDirectory();
            return { name: e.name, path, type: isDir ? 'dir' : 'file' };
          } catch {
            return undefined;
          }
        }
        return { name: e.name, path, type: e.isDirectory() ? 'dir' : 'file' };
      }),
  );
  return nodes
    .filter((n) => n !== undefined)
    .sort(
      (a, b) =>
        Number(b.type === 'dir') - Number(a.type === 'dir') ||
        a.name.localeCompare(b.name),
    );
}

export async function read(root: string, rel: string): Promise<FileContent> {
  const buf = await readFile(resolveInSpace(root, rel)).catch((e: unknown) => {
    const code = (e as NodeJS.ErrnoException).code;
    throw code === 'ENOENT' || code === 'EISDIR' ? notFound() : e;
  });
  if (buf.subarray(0, 8192).includes(0))
    throw new AppError('BINARY_FILE', 'Binary file', 415);
  return { path: rel, content: buf.toString('utf8') };
}

export async function create(
  root: string,
  rel: string,
  content = '',
): Promise<void> {
  const abs = resolveInSpace(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, { flag: 'wx' }).catch((e: unknown) => {
    throw (e as NodeJS.ErrnoException).code === 'EEXIST'
      ? new AppError('FILE_EXISTS', 'File already exists', 409)
      : e;
  });
}

export async function write(
  root: string,
  rel: string,
  content: string,
): Promise<void> {
  const abs = resolveInSpace(root, rel);
  const isFile = await stat(abs).then(
    (s) => s.isFile(),
    () => false,
  );
  if (!isFile) throw notFound();
  await writeFile(abs, content);
}
