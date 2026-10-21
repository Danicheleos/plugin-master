import { extractBlock, flattenBlocks, moveBlock, parseSkill, replaceBlock, slugify, type Block } from '@pm/protocol';

export const sections = (text: string) => flattenBlocks(parseSkill(text).blocks);

const siblingsOf = (blocks: Block[], id: string): Block[] =>
  blocks.some((b) => b.id === id) ? blocks : blocks.flatMap((b) => siblingsOf(b.children, id));

/** Movable siblings of a block (the preamble stays first). */
export const movable = (text: string, id: string) =>
  siblingsOf(parseSkill(text).blocks, id).filter((b) => b.kind === 'section');

const find = (text: string, id: string) => {
  const b = sections(text).find((x) => x.id === id);
  if (!b) throw new Error(`Block not found: ${id}`);
  return b;
};

/** The block's own text: heading and content before the first child. */
export const ownText = (text: string, id: string) => {
  const b = find(text, id);
  return text.slice(b.start, b.contentEnd);
};

/** Replaces only the block's own text; its children stay untouched. */
export function editOwn(text: string, id: string, own: string): string {
  const b = find(text, id);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const head = b.children.length && !own.endsWith('\n') ? own + eol : own;
  return replaceBlock(text, id, head + text.slice(b.contentEnd, b.end));
}

export const sectionText = (text: string, id: string) => {
  const b = find(text, id);
  return text.slice(b.start, b.end);
};

export const lineCount = (text: string, b: Block) => text.slice(b.start, b.end).trimEnd().split('\n').length;

export function shift(text: string, id: string, dir: -1 | 1): string {
  const sibs = movable(text, id);
  const other = sibs[sibs.findIndex((b) => b.id === id) + dir];
  return other ? moveBlock(text, id, other.id, dir < 0 ? 'before' : 'after') : text;
}

/** `references/<slug>.md`, numbered (`-2`, ...) while the file exists. */
function freeSubPath(title: string, existing: ReadonlySet<string>): string {
  const base = `references/${slugify(title)}`;
  let path = `${base}.md`;
  for (let n = 2; existing.has(path); n++) path = `${base}-${n}.md`;
  return path;
}

export const extractTo = (text: string, id: string, existing: ReadonlySet<string>) =>
  extractBlock(text, id, freeSubPath(find(text, id).title, existing));

/** Swaps the YAML between the fences, keeping the rest of the file. */
export function setFrontmatter(text: string, raw: string): string {
  const fm = parseSkill(text).frontmatter;
  if (!fm) throw new Error('No frontmatter');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return `${text.slice(0, fm.start)}---${eol}${raw.replace(/\r?\n$/, '')}${eol}---${eol}${text.slice(fm.end)}`;
}
