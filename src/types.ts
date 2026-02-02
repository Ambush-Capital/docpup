export type ScanConfig = {
  includeMd: boolean;
  includeMdx: boolean;
  includeHiddenDirs?: boolean;
  excludeDirs: string[];
};

export type RepoPreprocessConfig = {
  type: "sphinx";
  workDir?: string;
  builder?: "markdown";
  outputDir?: string;
};

export type RepoConfig = {
  name: string;
  repo: string;
  sourcePath: string;
  ref?: string;
  preprocess?: RepoPreprocessConfig;
  scan?: Partial<ScanConfig>;
};

export type DocpupConfig = {
  docsDir: string;
  indicesDir: string;
  gitignore: {
    addDocsDir: boolean;
    addIndexFiles: boolean;
    sectionHeader: string;
  };
  scan: ScanConfig;
  repos: RepoConfig[];
  concurrency?: number;
};
