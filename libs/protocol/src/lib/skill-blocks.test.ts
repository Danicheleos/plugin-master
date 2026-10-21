import { describe, expect, it } from 'vitest';
import {
  deleteBlock,
  extractBlock,
  flattenBlocks,
  insertBlock,
  moveBlock,
  parseSkill,
  replaceBlock,
  serialize,
  setDescription,
  slugify,
} from './skill-blocks.js';

const FM = '---\nname: demo\ndescription: d\n---\n';
const DOC = `${FM}Intro text.\n\n# One\nbody one\n\n## One A\na\n\n## One B\nb\n\n# Two\nbody two\n`;

const tricky: Record<string, string> = {
  empty: '',
  crlf: '---\r\nname: x\r\n---\r\n# A\r\ntext  \r\n\r\n## B\r\nmore\r\n',
  noFinalNewline: '# A\ntext\n## B\nlast',
  trailingWs: '# A  \n  \ntext \t\n\n\n',
  htmlComment: '<!-- # not a heading -->\n# A\n<!--\n# nope\n-->\ntext\n',
  fenceHash: '# A\n```md\n# fake\n---\n```\n~~~\n## fake2\n~~~\ntext\n',
  setext: 'Title\n=====\ntext\n\nSub\n---\nmore\n',
  inList: '# A\n- item\n  # not a heading\n> # quoted\n\n1. x\n   ## nope\n',
  tabs: '#\tA\n\ttabbed code\n\n##\tB\t\n',
  bom: '﻿---\nname: x\n---\n# A\ntext\n',
  bomNoFm: '﻿# A\ntext\n',
  badYaml: '---\nname: [unclosed\n---\n# A\n',
  hrNotFm: 'text\n\n---\n\n# A\n',
};

describe('parseSkill / serialize', () => {
  for (const [name, text] of Object.entries(tricky)) {
    it(`round-trips ${name}`, () => {
      expect(serialize(parseSkill(text))).toBe(text);
    });
  }

  it('builds a tree with exact ranges', () => {
    const doc = parseSkill(DOC);
    expect(doc.frontmatter?.raw).toBe('name: demo\ndescription: d');
    expect(doc.frontmatter?.data).toEqual({ name: 'demo', description: 'd' });
    expect(DOC.slice(doc.frontmatter!.start, doc.frontmatter!.end)).toBe(FM);
    expect(doc.blocks.map((b) => [b.id, b.kind, b.level, b.title])).toEqual([
      ['preamble', 'preamble', 0, ''],
      ['0', 'section', 1, 'One'],
      ['1', 'section', 1, 'Two'],
    ]);
    const one = doc.blocks[1]!;
    expect(DOC.slice(one.start, one.end)).toBe('# One\nbody one\n\n## One A\na\n\n## One B\nb\n\n');
    expect(DOC.slice(one.start, one.contentEnd)).toBe('# One\nbody one\n\n');
    expect(DOC.slice(one.headEnd, one.contentEnd)).toBe('body one\n\n');
    expect(one.children.map((c) => [c.id, c.title])).toEqual([
      ['0.0', 'One A'],
      ['0.1', 'One B'],
    ]);
    expect(DOC.slice(doc.blocks[0]!.start, doc.blocks[0]!.end)).toBe('Intro text.\n\n');
  });

  it('has no preamble when the doc starts with a heading', () => {
    expect(parseSkill('# A\nx\n').blocks.map((b) => b.id)).toEqual(['0']);
  });

  it('splits only on top-level headings', () => {
    const titles = (t: string) => flattenBlocks(parseSkill(t).blocks).filter((b) => b.kind === 'section').map((b) => b.title);
    expect(titles(tricky.inList!)).toEqual(['A']);
    expect(titles(tricky.fenceHash!)).toEqual(['A']);
    expect(titles(tricky.htmlComment!)).toEqual(['A']);
    expect(titles(tricky.setext!)).toEqual(['Title', 'Sub']);
    expect(titles(tricky.tabs!)).toEqual(['A', 'B']);
  });

  it('handles BOM offsets and skipped heading levels', () => {
    const t = tricky.bom!;
    const doc = parseSkill(t);
    expect(t.slice(doc.blocks[0]!.start, doc.blocks[0]!.end)).toBe('# A\ntext\n');
    const skip = parseSkill('# A\n### C\nx\n## B\n');
    expect(skip.blocks[0]!.children.map((c) => [c.level, c.title])).toEqual([
      [3, 'C'],
      [2, 'B'],
    ]);
  });

  it('reports YAML errors', () => {
    expect(parseSkill(tricky.badYaml!).frontmatter?.error).toBeTruthy();
  });
});

/** Everything outside [start, end) of `before` must reappear unchanged. */
function untouched(before: string, after: string, start: number, end: number) {
  expect(after.startsWith(before.slice(0, start))).toBe(true);
  expect(after.endsWith(before.slice(end))).toBe(true);
}

describe('ops', () => {
  const doc = parseSkill(DOC);
  const one = doc.blocks[1]!;
  const two = doc.blocks[2]!;

  it('replaceBlock', () => {
    const out = replaceBlock(DOC, '0.0', '## New\nz\n\n');
    expect(out).toBe(DOC.replace('## One A\na\n\n', '## New\nz\n\n'));
    untouched(DOC, out, one.children[0]!.start, one.children[0]!.end);
  });

  it('deleteBlock', () => {
    const out = deleteBlock(DOC, '0');
    expect(out).toBe(`${FM}Intro text.\n\n# Two\nbody two\n`);
    untouched(DOC, out, one.start, one.end);
    expect(deleteBlock(DOC, 'preamble')).toBe(DOC.replace('Intro text.\n\n', ''));
  });

  it('moveBlock moves children along (before and after)', () => {
    const sec = DOC.slice(one.start, one.end);
    const after = moveBlock(DOC, '0', '1', 'after');
    expect(after).toBe(`${FM}Intro text.\n\n# Two\nbody two\n${sec}`);
    expect(parseSkill(moveBlock(after, '1', '0', 'before')).blocks.map((b) => b.title)).toEqual(['', 'One', 'Two']);
    const nested = moveBlock(DOC, '0.1', '0.0', 'before');
    expect(nested).toBe(DOC.replace('## One A\na\n\n## One B\nb\n\n', '## One B\nb\n\n## One A\na\n\n'));
    expect(parseSkill(moveBlock(DOC, '1', '0', 'before')).blocks.map((b) => b.title)).toEqual(['', 'Two', 'One']);
  });

  it('moveBlock keeps headings separate from preceding paragraphs', () => {
    const t = '# A\npara\n# B\nb\n\nSetext\n===\ns';
    const out = moveBlock(t, '2', '0', 'after');
    expect(parseSkill(out).blocks.map((b) => b.title)).toEqual(['A', 'Setext', 'B']);
    expect(out).toBe('# A\npara\n\nSetext\n===\ns\n# B\nb\n\n');
  });

  it('moveBlock rejects moving into itself and no-ops in place', () => {
    expect(() => moveBlock(DOC, '0', '0.1', 'after')).toThrow();
    expect(moveBlock(DOC, '0', '1', 'before')).toBe(DOC);
    expect(moveBlock(DOC, '0', '0', 'after')).toBe(DOC);
  });

  it('insertBlock at top, end and relative', () => {
    expect(insertBlock(DOC, null, 'before', '# Top\nt\n\n')).toBe(DOC.replace('Intro', '# Top\nt\n\nIntro'));
    const end = insertBlock('# A\nx', null, 'after', '# Z\nz\n');
    expect(end).toBe('# A\nx\n# Z\nz\n');
    expect(insertBlock(DOC, '1', 'before', '# Mid\nm\n\n')).toBe(DOC.replace('# Two', '# Mid\nm\n\n# Two'));
    expect(insertBlock('﻿# A\n', null, 'before', '# T\n')).toBe('﻿# T\n# A\n');
    expect(insertBlock('# A\ntext\n', null, 'after', 'Setext\n---\n')).toBe('# A\ntext\n\nSetext\n---\n');
  });

  it('extractBlock moves the body to a sub-file', () => {
    const r = extractBlock(DOC, '0', 'references/one.md');
    expect(r.subFile).toEqual({
      path: 'references/one.md',
      content: 'body one\n\n## One A\na\n\n## One B\nb\n',
    });
    expect(r.text).toBe(`${FM}Intro text.\n\n# One\n\nSee [One](references/one.md).\n\n# Two\nbody two\n`);
    untouched(DOC, r.text, one.start, one.end);
    expect(() => extractBlock(DOC, 'preamble', 'x.md')).toThrow();
    expect(extractBlock('# A\nx', '0', 'r/a.md').text).toBe('# A\n\nSee [A](r/a.md).\n');
  });

  it('replacing a block with its own text is identity (no needless blank line)', () => {
    const t = '# A\nSetext\n===\nx\n';
    expect(replaceBlock(t, '0', '# A\n')).toBe(t);
  });

  it('throws on unknown ids', () => {
    expect(() => deleteBlock(DOC, '9')).toThrow(/not found/);
    expect(two.title).toBe('Two');
  });

  it('slugify', () => {
    expect(slugify('Hello, Wörld! 2')).toBe('hello-world-2');
    expect(slugify('***')).toBe('section');
  });
});

describe('setDescription', () => {
  const doc = (fm: string) => `---\n${fm}---\nBody\n`;
  it('replaces only the description line', () => {
    expect(setDescription(doc('name: a\ndescription: old\nmodel: x\n'), 'new "q"')).toBe(
      doc('name: a\ndescription: "new \\"q\\""\nmodel: x\n'),
    );
  });
  it('replaces folded multi-line values and keeps what follows', () => {
    const src = doc('name: a\n# c\ndescription: >\n  line1\n  line2\n\nallowed-tools: Read\n');
    expect(setDescription(src, 'd')).toBe(doc('name: a\n# c\ndescription: "d"\n\nallowed-tools: Read\n'));
  });
  it('adds a missing key, keeps CRLF', () => {
    expect(setDescription('---\r\nname: a\r\n---\r\nB', 'd')).toBe('---\r\nname: a\r\ndescription: "d"\r\n---\r\nB');
  });
  it('escapes colons, quotes, backslashes and unicode', () => {
    const d = 'Use: "x" \\ naïve 日本 😀 # not a comment';
    const out = setDescription(doc('name: a\ndescription: old\n'), d);
    expect((parseSkill(out).frontmatter?.data as { description: string }).description).toBe(d);
  });
  it('rejects newlines and missing frontmatter', () => {
    expect(() => setDescription(doc('name: a\n'), 'a\nb')).toThrow();
    expect(() => setDescription('# no fm\n', 'd')).toThrow();
  });
});
