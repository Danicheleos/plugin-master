import { lintSkill } from '@pm/protocol';
import { expect, it } from 'vitest';
import { skillNameError, skillTemplate } from './NewSkillDialog';

it('creates a SKILL.md that lints clean for every accepted name and tricky descriptions', () => {
  for (const name of ['a', 'my-skill-2', 'x'.repeat(64)])
    for (const d of ['Does: things', 'say "hi" # not a comment\nline 2', '- [x] {y}: z'.repeat(3)]) {
      expect(skillNameError(name, [])).toBeNull();
      const errors = lintSkill({ dirName: name, text: skillTemplate(name, d) }).problems.filter(
        (p) => p.severity === 'error',
      );
      expect(errors).toEqual([]);
    }
});

it('rejects names lintSkill rejects', () => {
  for (const name of ['', 'A', 'a_b', 'a b', 'x'.repeat(65)]) expect(skillNameError(name, [])).not.toBeNull();
});
