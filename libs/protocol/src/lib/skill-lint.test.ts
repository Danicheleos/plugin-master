import { describe, expect, it } from 'vitest';
import { lintSkill } from './skill-lint.js';

const skill = (fm: string, body = '# Title\nbody\n') => `---\n${fm}\n---\n${body}`;
const lint = (text: string, existingFiles?: Set<string>, dirName = 'demo') => lintSkill({ dirName, text, existingFiles });
const has = (r: ReturnType<typeof lint>, severity: string, field: string, re?: RegExp) =>
  r.problems.some((p) => p.severity === severity && p.field === field && (!re || re.test(p.message)));

describe('lintSkill', () => {
  it('accepts a minimal valid skill', () => {
    const r = lint(skill('name: demo\ndescription: Does things'));
    expect(r.problems).toEqual([]);
    expect(r.stats).toMatchObject({ bodyLines: 2, descriptionChars: 11, listingChars: 11 });
  });

  it('requires frontmatter, name and description', () => {
    expect(has(lint('# no fm\n'), 'error', 'frontmatter')).toBe(true);
    const r = lint(skill('license: MIT'));
    expect(has(r, 'error', 'name', /required/)).toBe(true);
    expect(has(r, 'error', 'description', /required/)).toBe(true);
    expect(has(lint(skill('name: [x')), 'error', 'frontmatter', /Invalid YAML/)).toBe(true);
  });

  it('validates name', () => {
    expect(has(lint(skill('name: Demo\ndescription: d')), 'error', 'name', /lowercase/)).toBe(true);
    expect(has(lint(skill('name: other\ndescription: d')), 'error', 'name', /directory/)).toBe(true);
    const long = 'a'.repeat(65);
    expect(has(lint(skill(`name: ${long}\ndescription: d`), undefined, long), 'error', 'name', /max 64/)).toBe(true);
  });

  it('validates description and listing length', () => {
    expect(has(lint(skill(`name: demo\ndescription: ${'x'.repeat(1025)}`)), 'error', 'description', /1024/)).toBe(true);
    const r = lint(skill(`name: demo\ndescription: ${'x'.repeat(1000)}\nwhen_to_use: ${'y'.repeat(600)}`));
    expect(has(r, 'warning', 'description', /1600.*64 over/)).toBe(true);
    expect(r.stats.listingChars).toBe(1600);
    expect(has(lint(skill(`name: demo\ndescription: ${'x'.repeat(1000)}`)), 'warning', 'description')).toBe(false);
  });

  it('classifies extra fields', () => {
    const r = lint(skill('name: demo\ndescription: d\nlicense: MIT\nmodel: opus\nbogus: 1\nallowed-tools: Read'));
    expect(has(r, 'info', 'model', /not portable/)).toBe(true);
    expect(has(r, 'warning', 'bogus', /Unknown/)).toBe(true);
    expect(has(r, 'info', 'allowed-tools', /does not restrict/)).toBe(true);
    expect(r.problems.some((p) => p.field === 'license')).toBe(false);
  });

  it('warns on long bodies', () => {
    const lines = lint(skill('name: demo\ndescription: d', 'x\n'.repeat(501)));
    expect(has(lines, 'warning', 'body', /501 lines/)).toBe(true);
    const tokens = lint(skill('name: demo\ndescription: d', 'x'.repeat(20004)));
    expect(has(tokens, 'warning', 'body', /estimate/)).toBe(true);
    expect(tokens.stats.approxTokens).toBeGreaterThan(5000);
  });

  it('checks referenced files only when existingFiles is given', () => {
    const body = 'See [a](references/a.md) and [b](./references/b.md#x), scripts/run.sh.\n[web](https://x.y/z) [top](#top)\n```\nreferences/in-fence.md\n```\n';
    const text = skill('name: demo\ndescription: d', body);
    expect(lint(text).problems).toEqual([]);
    const r = lint(text, new Set(['references/a.md']));
    const missing = r.problems.filter((p) => p.field === 'body').map((p) => p.message);
    expect(missing).toEqual(['Referenced file not found: references/b.md', 'Referenced file not found: scripts/run.sh']);
    expect(lint(text, new Set(['references/a.md', 'references/b.md', 'scripts/run.sh'])).problems).toEqual([]);
  });
});
