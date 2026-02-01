export type RepoConfig = {
  name: string;
  repo: string;
  sourcePath: string;
  ref?: string;
};

export type DocpupConfig = {
  docsDir: string;
  indicesDir: string;
  gitignore: {
    addDocsDir: boolean;
    addIndexFiles: boolean;
    sectionHeader: string;
  };
  scan: {
    includeMd: boolean;
    includeMdx: boolean;
    includeHiddenDirs?: boolean;
    excludeDirs: string[];
  };
  repos: RepoConfig[];
  concurrency?: number;
};
