import remarkFrontmatter from 'remark-frontmatter';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { parse as parseYaml } from 'yaml';

/**
 * Lossless SKILL.md block model. remark only locates top-level nodes; text is never
 * re-printed, every op splices slices of the original string.
 *
 * Block ids: `preamble`, or the index path among section siblings (`0`, `0.2`, ...).
 * Ids change when blocks are added/removed/moved, so ops take the current text.
 * Only top-level ATX/setext headings split sections (not those in lists or quotes).
 */
export interface Frontmatter {
  /** Inner YAML text (without fences). */
  raw: string;
  /** Range of the whole block: opening fence through the line break after the closing fence. */
  start: number;
  end: number;
  data: unknown;
  /** YAML parse error message, else null. */
  error: string | null;
}

export interface Block {
  id: string;
  kind: 'preamble' | 'section';
  /** Heading depth 1-6; 0 for the preamble. */
  level: number;
  title: string;
  /** Whole section (heading through the last child), UTF-16 offsets into the source. */
  start: number;
  end: number;
  /** Offset just after the heading line (= start for the preamble). */
  headEnd: number;
  /** End of own content, before the first child (= end without children). */
  contentEnd: number;
  children: Block[];
}

export interface SkillDoc {
  source: string;
  frontmatter: Frontmatter | null;
  blocks: Block[];
}

interface Pos {
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const BOM = '﻿';
const nl = (t: string) => (t.includes('\r\n') ? '\r\n' : '\n');

export function parseSkill(source: string): SkillDoc {
  const base = source.startsWith(BOM) ? 1 : 0;
  const root = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).parse(source.slice(base));
  const off = (n: number | undefined) => (n ?? 0) + base;
  const lineEnd = (o: number) => {
    const i = source.indexOf('\n', o);
    return i < 0 ? source.length : i + 1;
  };

  let frontmatter: Frontmatter | null = null;
  const stack: Block[] = [];
  const top: Block[] = [];
  for (const node of root.children) {
    const p = (node as Pos).position;
    if (node.type === 'yaml' && p && !frontmatter) {
      const start = off(p.start.offset);
      let data: unknown = null;
      let error: string | null = null;
      try {
        data = parseYaml(node.value);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      frontmatter = { raw: node.value, start, end: lineEnd(off(p.end.offset)), data, error };
    } else if (node.type === 'heading' && p) {
      const hs = source.lastIndexOf('\n', off(p.start.offset) - 1) + 1;
      const kids = node.children;
      const a = (kids[0] as Pos | undefined)?.position?.start.offset;
      const z = (kids.at(-1) as Pos | undefined)?.position?.end.offset;
      const b: Block = {
        id: '',
        kind: 'section',
        level: node.depth,
        title: a === undefined || z === undefined ? '' : source.slice(off(a), off(z)).trim(),
        start: hs,
        end: source.length,
        headEnd: lineEnd(off(p.end.offset)),
        contentEnd: source.length,
        children: [],
      };
      while (stack.length && stack.at(-1)!.level >= b.level) closeBlock(stack.pop()!, hs);
      const parent = stack.at(-1);
      const siblings = parent ? parent.children : top;
      b.id = parent ? `${parent.id}.${siblings.length}` : String(siblings.length);
      siblings.push(b);
      stack.push(b);
    }
  }
  const lastEnd = source.length;
  while (stack.length) closeBlock(stack.pop()!, lastEnd);

  const bodyStart = frontmatter ? frontmatter.end : base;
  const firstStart = top[0]?.start ?? source.length;
  const blocks = [...top];
  if (source.slice(bodyStart, firstStart).trim() !== '') {
    blocks.unshift({
      id: 'preamble',
      kind: 'preamble',
      level: 0,
      title: '',
      start: bodyStart,
      end: firstStart,
      headEnd: bodyStart,
      contentEnd: firstStart,
      children: [],
    });
  }
  return { source, frontmatter, blocks };
}

function closeBlock(b: Block, end: number) {
  b.end = end;
  b.contentEnd = b.children[0]?.start ?? end;
}

export function serialize(doc: SkillDoc): string {
  return doc.source;
}

export function flattenBlocks(blocks: Block[]): Block[] {
  return blocks.flatMap((b) => [b, ...flattenBlocks(b.children)]);
}

function find(text: string, id: string): Block {
  const b = flattenBlocks(parseSkill(text).blocks).find((x) => x.id === id);
  if (!b) throw new Error(`Block not found: ${id}`);
  return b;
}

/** True if `s` is empty or its last line cannot continue into a following setext heading's text. */
const endsBlank = (s: string) => {
  const last = s.replace(/\r?\n$/, '').split('\n').pop()!;
  return !s || !last.trim() || /^ {0,3}(#{1,6}([ \t]|$)|(```|~~~)|([-*_][ \t]*){3,}$|=+[ \t]*$)|-->[ \t]*$/.test(last);
};
/** A setext heading glues to a preceding paragraph line unless a blank line separates them. */
const isSetext = (s: string) => /^[^\n]*\r?\n {0,3}(=+|-+)[ \t]*(\r?\n|$)/.test(s) && !/^ {0,3}#/.test(s);

/** Replaces text[start,end) with `sec`, adding only the line breaks needed to keep headings separate. */
function splice(text: string, start: number, end: number, sec: string): string {
  const eol = nl(text);
  let before = text.slice(0, start);
  const after = text.slice(end);
  if (before && before !== BOM && !before.endsWith('\n')) before += eol;
  const lead = before === BOM ? '' : before;
  if (sec) {
    if (after && !sec.endsWith('\n')) sec += eol;
    if (lead && isSetext(sec) && !endsBlank(lead)) before += eol;
    if (after && isSetext(after) && !endsBlank(sec)) sec += eol;
  } else if (lead && after && isSetext(after) && !endsBlank(lead)) {
    before += eol;
  }
  return before + sec + after;
}

export function replaceBlock(text: string, id: string, newSection: string): string {
  const b = find(text, id);
  return splice(text, b.start, b.end, newSection);
}

export function deleteBlock(text: string, id: string): string {
  const b = find(text, id);
  return splice(text, b.start, b.end, '');
}

/** Insertion offset: `before`/`after` a block, or the body start/end of the file when targetId is null. */
function insertPos(text: string, doc: SkillDoc, targetId: string | null, position: 'before' | 'after'): number {
  if (targetId === null) return position === 'after' ? text.length : (doc.frontmatter?.end ?? (text.startsWith(BOM) ? 1 : 0));
  const t = flattenBlocks(doc.blocks).find((x) => x.id === targetId);
  if (!t) throw new Error(`Block not found: ${targetId}`);
  return position === 'before' ? t.start : t.end;
}

export function insertBlock(
  text: string,
  targetId: string | null,
  position: 'before' | 'after',
  sectionText: string,
): string {
  const p = insertPos(text, parseSkill(text), targetId, position);
  return splice(text, p, p, sectionText);
}

/** Moves a section (with its children) before/after another block. A no-op if already there. */
export function moveBlock(text: string, id: string, targetId: string, position: 'before' | 'after'): string {
  const doc = parseSkill(text);
  const b = flattenBlocks(doc.blocks).find((x) => x.id === id);
  if (!b) throw new Error(`Block not found: ${id}`);
  if (targetId.startsWith(`${id}.`)) throw new Error('Cannot move a block into itself');
  const p = insertPos(text, doc, targetId, position);
  if (p === b.start || p === b.end) return text;
  const sec = text.slice(b.start, b.end);
  const removed = splice(text, b.start, b.end, '');
  const q = p > b.end ? p - sec.length + (removed.length - (text.length - sec.length)) : p;
  return splice(removed, q, q, sec);
}

export function slugify(title: string): string {
  const s = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'section';
}

/**
 * Moves the section body (everything after the heading line, children included) into a
 * sub-file and leaves the heading plus `See [Title](subPath).` in its place.
 * The preamble cannot be extracted. The sub-file is trimmed and ends with one newline.
 */
export function extractBlock(
  text: string,
  id: string,
  subPath: string,
): { text: string; subFile: { path: string; content: string } } {
  const b = find(text, id);
  if (b.kind === 'preamble') throw new Error('Cannot extract the preamble');
  const eol = nl(text);
  const body = text.slice(b.headEnd, b.end).trim();
  const head = text.slice(b.start, b.headEnd);
  const label = b.title.replace(/[[\]]/g, '\\$&');
  const sec = `${head.endsWith('\n') ? head : head + eol}${eol}See [${label}](${subPath}).${eol}${b.end < text.length ? eol : ''}`;
  return {
    text: splice(text, b.start, b.end, sec),
    subFile: { path: subPath, content: body ? body + eol : '' },
  };
}

/** Control characters and line separators: a description with them cannot be written as one YAML line. */
// eslint-disable-next-line no-control-regex
export const UNSAFE_DESCRIPTION = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * Lossless: replaces only the frontmatter `description` value (as one double-quoted line; added when missing),
 * every other byte stays. Throws when the frontmatter is missing or invalid, or the result does not parse back
 * to the same data with only `description` changed.
 */
export function setDescription(text: string, description: string): string {
  if (UNSAFE_DESCRIPTION.test(description)) throw new Error('The description must be a single line');
  const fm = parseSkill(text).frontmatter;
  const before = fm?.data;
  if (!fm || fm.error || !before || typeof before !== 'object' || Array.isArray(before))
    throw new Error('SKILL.md has no valid frontmatter');
  const eol = nl(text);
  const lines = text.slice(fm.start, fm.end).split(/(?<=\n)/);
  const closing = lines.length - 1;
  const line = `description: ${JSON.stringify(description)}${eol}`;
  const i = lines.findIndex((l, k) => k > 0 && k < closing && /^description[ \t]*:/.test(l));
  let out: string[];
  if (i < 0) out = [...lines.slice(0, closing), line, lines[closing]!];
  else {
    let j = i + 1;
    while (j < closing && /^([ \t]|\r?\n)/.test(lines[j]!)) j++;
    while (j > i + 1 && /^\s*$/.test(lines[j - 1]!)) j--; // keep blank lines after the value
    out = [...lines.slice(0, i), line, ...lines.slice(j)];
  }
  const next = text.slice(0, fm.start) + out.join('') + text.slice(fm.end);
  const after = parseSkill(next).frontmatter;
  const want = JSON.stringify({ ...(before as object), description });
  const got = after && !after.error ? after.data : null;
  const sameKeys = (o: unknown) =>
    JSON.stringify(Object.entries(o as object).filter(([k]) => k !== 'description').sort());
  if (!got || (got as { description?: unknown }).description !== description || sameKeys(got) !== sameKeys(JSON.parse(want)))
    throw new Error('Could not set the description without changing other frontmatter keys');
  return next;
}
