import { describe, expect, it } from 'vitest';
import { GitBranchesSchema, GitStatusSchema } from './git.js';
import { ExperimentDiffSchema } from './experiments.js';
import { VersionsResponseSchema } from './versions.js';

describe('response schemas used by the web client', () => {
  it('git status accepts a repo and a non-repo, rejects a missing file list', () => {
    expect(GitStatusSchema.parse({ isRepo: false })).toEqual({ isRepo: false });
    expect(
      GitStatusSchema.parse({
        isRepo: true,
        branch: null,
        files: [{ path: 'a', index: ' ', workingDir: 'M' }],
      }),
    ).toHaveProperty('isRepo', true);
    expect(
      GitStatusSchema.safeParse({ isRepo: true, branch: 'main' }).success,
    ).toBe(false);
  });

  it('git branches', () => {
    expect(
      GitBranchesSchema.parse({ current: 'main', local: ['main'] }).local,
    ).toEqual(['main']);
    expect(GitBranchesSchema.safeParse({ current: 1, local: [] }).success).toBe(
      false,
    );
  });

  it('experiment diff nests git diffs', () => {
    const d = { files: [{ path: 'a', old: '', new: 'x' }], truncated: true };
    expect(ExperimentDiffSchema.parse(d)).toEqual(d);
    expect(
      ExperimentDiffSchema.safeParse({ files: [{ path: 'a' }] }).success,
    ).toBe(false);
  });

  it('versions list', () => {
    const c = {
      hash: 'h',
      date: 'd',
      message: 'm',
      author: 'a',
      trendable: true,
    };
    expect(VersionsResponseSchema.parse({ commits: [c] }).commits).toHaveLength(
      1,
    );
    expect(
      VersionsResponseSchema.safeParse({
        commits: [{ ...c, trendable: 'yes' }],
      }).success,
    ).toBe(false);
  });
});
