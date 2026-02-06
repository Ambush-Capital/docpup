export type ContentType = "docs" | "source";

export type ScanConfig = {
  includeMd: boolean;
  includeMdx: boolean;
  includeHiddenDirs?: boolean;
  excludeDirs: string[];
  extensions?: string[];
};

export type RepoPreprocessConfig =
  | {
      type: "sphinx";
      workDir?: string;
      builder?: "markdown";
      outputDir?: string;
    }
  | {
      type: "html";
      workDir?: string;
      outputDir?: string;
      selector?: string;
      rewriteLinks?: boolean;
    };

export type RepoConfig = {
  name: string;
  repo: string;
  sourcePath?: string;
  sourcePaths?: string[];
  ref?: string;
  preprocess?: RepoPreprocessConfig;
  scan?: Partial<ScanConfig>;
  contentType?: ContentType;
};

export type DocpupConfig = {
  docsDir: string;
  indicesDir: string;
  gitignore: {
    addDocsDir: boolean;
    addDocsSubDirs: boolean;
    addIndexFiles: boolean;
    sectionHeader: string;
  };
  scan: ScanConfig;
  repos: RepoConfig[];
  concurrency?: number;
};
