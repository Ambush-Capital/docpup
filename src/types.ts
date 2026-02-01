export type RepoConfig = {
  name: string;
  repo: string;
  sourcePath: string;
  ref?: string;
};

export type GitignoreConfig = {
  addDocsDir: boolean;
  addIndexFiles: boolean;
  sectionHeader: string;
};

export type ScanConfig = {
  includeMd: boolean;
  includeMdx: boolean;
  excludeDirs: string[];
};

export type DocpupConfig = {
  docsDir: string;
  indicesDir: string;
  gitignore: GitignoreConfig;
  scan: ScanConfig;
  repos: RepoConfig[];
  concurrency?: number;
};

export type SparseCheckoutResult =
  | { success: true; path: string }
  | { success: false; error: string };

export type DocTree = Map<string, string[]>;
