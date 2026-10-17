import { readFile } from 'node:fs/promises';
import { AppError } from '../lib/errors';
import { resolveInSpace } from '../files/safe-path';

const HEADER = `# plugin-master context
The files below are the source of truth for this plugin's goal and current state. Read them before acting.`;

/** Reads a pinned file; null when it does not exist. Other problems throw an error naming the path. */
async function read(root: string, rel: string): Promise<string | null> {
  let content: string;
  try {
    content = await readFile(resolveInSpace(root, rel), 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    if (e instanceof AppError)
      throw new AppError(e.code, `"${rel}" is outside the space`, e.status);
    if (code === 'EISDIR')
      throw new AppError('CONTEXT_NOT_FILE', `"${rel}" is a directory`, 400);
    throw e;
  }
  if (content.includes('\0'))
    throw new AppError('FILE_BINARY', `"${rel}" is not a text file`, 400);
  return content;
}

/**
 * Builds the master-agent system prompt part from space files, in the given order.
 * Missing files are skipped and listed in `missing`; paths outside the space, directories
 * and binary files throw.
 */
export async function buildContext(
  root: string,
  files: string[],
): Promise<{ text: string; missing: string[] }> {
  const blocks: string[] = [];
  const missing: string[] = [];
  for (const rel of files) {
    const content = await read(root, rel);
    if (content === null) missing.push(rel);
    else
      blocks.push(
        `<file path="${rel.replaceAll('"', '&quot;')}">\n${content.replaceAll('</file>', '<\\/file>')}\n</file>`,
      );
  }
  return { text: [HEADER, ...blocks].join('\n\n'), missing };
}
