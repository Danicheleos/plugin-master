import { z } from 'zod';

// Plain response types of the git API (produced by our own server code).
export type GitFile = {
  path: string;
  from?: string;
  index: string;
  workingDir: string;
};
export type GitStatus =
  | { isRepo: false }
  | {
      isRepo: true;
      branch: string | null;
      ahead?: number;
      behind?: number;
      files: GitFile[];
    };
export type GitDiff = {
  path: string;
  old: string;
  new: string;
  binary?: boolean;
  tooLarge?: boolean;
};
export type GitCommit = {
  hash: string;
  date: string;
  message: string;
  author: string;
};
export type GitBranches = { current: string | null; local: string[] };

// Runtime schemas for the web client (the annotations keep them in step with the types above).
export const GitFileSchema: z.ZodType<GitFile> = z.object({
  path: z.string(),
  from: z.string().optional(),
  index: z.string(),
  workingDir: z.string(),
});
export const GitStatusSchema: z.ZodType<GitStatus> = z.union([
  z.object({ isRepo: z.literal(false) }),
  z.object({
    isRepo: z.literal(true),
    branch: z.string().nullable(),
    ahead: z.number().optional(),
    behind: z.number().optional(),
    files: z.array(GitFileSchema),
  }),
]);
export const GitDiffSchema: z.ZodType<GitDiff> = z.object({
  path: z.string(),
  old: z.string(),
  new: z.string(),
  binary: z.boolean().optional(),
  tooLarge: z.boolean().optional(),
});
export const GitCommitSchema: z.ZodType<GitCommit> = z.object({
  hash: z.string(),
  date: z.string(),
  message: z.string(),
  author: z.string(),
});
export const GitBranchesSchema: z.ZodType<GitBranches> = z.object({
  current: z.string().nullable(),
  local: z.array(z.string()),
});
