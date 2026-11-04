import { describe, expect, it } from 'vitest';
import { changedGraders } from './compare';

describe('changedGraders', () => {
  it('lists graders with a different pass rate', () => {
    const a = { graders: { g: 1, h: 1 } };
    const b = { graders: { g: 0, h: 1 } };
    expect(changedGraders(a, b)).toEqual(['g']);
    expect(changedGraders(a, a)).toEqual([]);
  });
  it('a grader missing on one side counts as changed', () => {
    expect(changedGraders({ graders: { g: 1 } }, {})).toEqual(['g']);
  });
});
