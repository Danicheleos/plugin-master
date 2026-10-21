import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deleteBlock, extractBlock, flattenBlocks, moveBlock, parseSkill, replaceBlock, serialize, type Block } from './skill-blocks.js';

// Opt-in: PM_SKILLS_DIR=<dir> pnpm nx test @pm/protocol. Read-only; files are never copied.
const dir = process.env.PM_SKILLS_DIR;

function find(d: string, out: string[] = []): string[] {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) find(p, out);
    else if (e.name === 'SKILL.md') out.push(p);
  }
  return out;
}

describe.skipIf(!dir)('real SKILL.md files', () => {
  it('round-trip identically', () => {
    const files = find(dir!);
    const bad = files.filter((f) => {
      const text = readFileSync(f, 'utf8');
      const doc = parseSkill(text);
      // Sections must tile the body: ranges contiguous, children nested in order.
      const tiles = (bs: typeof doc.blocks, from: number, to: number): boolean => {
        let at = from;
        return bs.every((b) => {
          const ok = b.start >= at && b.end >= b.start && b.end <= to && tiles(b.children, b.headEnd, b.end);
          at = b.end;
          return ok;
        });
      };
      const spliced = tiles(doc.blocks, 0, text.length);
      return serialize(doc) !== text || !spliced;
    });
    console.log(`SKILL.md round-trip: ${files.length - bad.length}/${files.length} identical`);
    expect(bad).toEqual([]);
  }, 120_000);

  it('ops keep their invariants on every block', () => {
    const CAP = 12; // blocks per file and op, to keep the run fast
    const files = find(dir!);
    const counts: Record<string, number> = { replace: 0, delete: 0, move: 0, extract: 0 };
    const failures: string[] = [];
    const check = (ok: boolean, op: string, file: number, id: string) => {
      counts[op]!++;
      if (!ok) failures.push(`${op} file#${file} block ${id}`);
    };
    const titles = (bs: Block[]) => flattenBlocks(bs).map((b) => `${b.kind}:${b.title}`);
    const collapse = (t: string) => t.replace(/(\r?\n)+/g, '\n');

    files.forEach((f, n) => {
      const text = readFileSync(f, 'utf8');
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const doc = parseSkill(text);
      const all = flattenBlocks(doc.blocks).slice(0, CAP);
      for (const b of all) {
        const sec = text.slice(b.start, b.end);
        const pre = text.slice(0, b.start);
        const post = text.slice(b.end);
        check(replaceBlock(text, b.id, sec) === text, 'replace', n, b.id);

        // delete: splice may add one line break after the prefix, nothing else
        const del = deleteBlock(text, b.id);
        const removed = new Set(flattenBlocks([b]).map((x) => x.id));
        const want = flattenBlocks(doc.blocks).filter((x) => !removed.has(x.id)).map((x) => `${x.kind}:${x.title}`);
        const delOk = (del === pre + post || del === pre + eol + post) && titles(parseSkill(del).blocks).join('\n') === want.join('\n');
        check(delOk, 'delete', n, b.id);

        if (b.kind === 'section') {
          const r = extractBlock(text, b.id, 'references/x.md');
          const again = flattenBlocks(parseSkill(r.text).blocks).find((x) => x.id === b.id);
          const ok =
            r.subFile.content.trim() === text.slice(b.headEnd, b.end).trim() &&
            r.text.startsWith(pre) &&
            r.text.endsWith(post) &&
            again?.title === b.title &&
            again.level === b.level;
          check(ok, 'extract', n, b.id);
        }
      }

      // move each top-level section after the last one, then back before its old successor
      const top = doc.blocks;
      const last = top.at(-1);
      top.slice(0, CAP).forEach((b, i) => {
        if (b.kind === 'preamble' || b === last || !last) return;
        const moved = moveBlock(text, b.id, last.id, 'after');
        const sections = (t: string) => parseSkill(t).blocks.map((x) => t.slice(x.start, x.end).trim()).sort();
        const mdoc = parseSkill(moved);
        const next = mdoc.blocks[i]; // the old successor now sits at index i
        const back = next ? moveBlock(moved, mdoc.blocks.at(-1)!.id, next.id, 'before') : moved;
        const ok =
          sections(moved).join('\0') === sections(text).join('\0') &&
          (back === text || (collapse(back) === collapse(text) && Math.abs(back.length - text.length) <= 4 * eol.length));
        check(ok, 'move', n, b.id);
      });
    });
    console.log(`ops checked: ${JSON.stringify(counts)}, failures: ${failures.length}`);
    expect(failures).toEqual([]);
  }, 600_000);
});
