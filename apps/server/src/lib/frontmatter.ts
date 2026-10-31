import { parse } from 'yaml';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

/** YAML between the leading `---` lines of a Markdown file, and the text after it; `data` is `{}` when absent. */
export function splitFrontmatter(src: string): { data: Record<string, unknown>; body: string } {
  const m = FRONTMATTER.exec(src);
  return m ? { data: asObject(parse(m[1])), body: src.slice(m[0].length) } : { data: {}, body: src };
}
