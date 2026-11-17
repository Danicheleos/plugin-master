import { describe, expect, it } from 'vitest';
import { buildRunRequest } from './runRequest';

describe('buildRunRequest', () => {
  it('keeps only the cost for an untouched form', () => {
    expect(
      buildRunRequest({
        cost: '1',
        cases: [],
        tags: [],
        runs: '',
        model: '',
        allowTools: [],
      }),
    ).toEqual({
      maxCostUsd: 1,
    });
  });
  it('includes every option that is set', () => {
    expect(
      buildRunRequest({
        cost: 2.5,
        cases: ['a'],
        tags: ['t'],
        runs: '3',
        model: 'opus',
        ablation: true,
        allowTools: ['Bash'],
        scaffold: true,
      }),
    ).toEqual({
      maxCostUsd: 2.5,
      cases: ['a'],
      tags: ['t'],
      runs: 3,
      model: 'opus',
      ablation: true,
      allowTools: ['Bash'],
      scaffold: true,
    });
  });
});
