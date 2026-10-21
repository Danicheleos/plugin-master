// Plain response types of the git API (produced by our own server code).
export type GitFile = { path: string; from?: string; index: string; workingDir: string };
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
export type GitCommit = { hash: string; date: string; message: string; author: string };
export type GitBranches = { current: string | null; local: string[] };
