/** A tool input/result text prepared for display (see `parseDetail`). */
export type Detail =
  | { kind: 'text'; text: string }
  | { kind: 'json'; value: object }
  | { kind: 'blocks'; parts: ({ text: string } | { label: string })[] };

const MAX_DECODE = 3; // JSON-encoded strings decoded this many times at most

type Block = { type: string; text?: unknown };
const isBlocks = (v: unknown): v is Block[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every(
    (b) =>
      typeof b === 'object' &&
      b !== null &&
      typeof (b as { type?: unknown }).type === 'string',
  );

/**
 * Pure: a JSON object/array becomes structure, an array of content blocks (`{type, text?}`)
 * becomes its text parts plus a label per other block, a JSON-encoded string is decoded (real
 * newlines); anything else, including JSON that does not parse (e.g. a cut preview), stays as is.
 */
export function parseDetail(raw: string, depth = 0): Detail {
  const t = raw.trim();
  if (depth >= MAX_DECODE || !/^[[{"]/.test(t))
    return { kind: 'text', text: raw };
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch {
    return { kind: 'text', text: raw };
  }
  if (typeof v === 'string') return parseDetail(v, depth + 1);
  if (isBlocks(v))
    return {
      kind: 'blocks',
      parts: v.map((b) =>
        b.type === 'text' && typeof b.text === 'string'
          ? { text: b.text }
          : { label: b.type },
      ),
    };
  if (typeof v === 'object' && v !== null) return { kind: 'json', value: v };
  return { kind: 'text', text: raw };
}
