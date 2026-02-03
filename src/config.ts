import path from "node:path";
import { cosmiconfig } from "cosmiconfig";
import { z } from "zod";
import type { DocpupConfig } from "./types.js";

const defaultExcludeDirs = [
  ".git",
  "node_modules",
  "images",
  "img",
  "media",
  "assets",
  "css",
  "fonts",
];

const repoNamePattern = /^[A-Za-z0-9._-]+$/;

const defaultGitignore = {
  addDocsDir: true,
  addIndexFiles: false,
  sectionHeader: "Docpup generated docs",
};

const defaultScan = {
  includeMd: true,
  includeMdx: true,
  includeHiddenDirs: false,
  excludeDirs: defaultExcludeDirs,
};

const gitignoreSchema = z
  .object({
    addDocsDir: z.boolean().optional(),
    addIndexFiles: z.boolean().optional(),
    sectionHeader: z.string().min(1).optional(),
  })
  .optional();

const scanSchema = z
  .object({
    includeMd: z.boolean().optional(),
    includeMdx: z.boolean().optional(),
    includeHiddenDirs: z.boolean().optional(),
    excludeDirs: z.array(z.string()).optional(),
    extensions: z
      .array(z.string().regex(/^\.[a-zA-Z0-9]+$/, "Extension must start with '.'"))
      .optional(),
  })
  .optional();

const repoSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(
        repoNamePattern,
        "Repo name must contain only letters, numbers, '.', '_', or '-'"
      ),
    repo: z.string().min(1),
    sourcePath: z.string().min(1).optional(),
    sourcePaths: z.array(z.string().min(1)).min(1).optional(),
    ref: z.string().min(1).optional(),
    preprocess: z
      .object({
        type: z.literal("sphinx"),
        workDir: z.string().min(1).optional(),
        builder: z.literal("markdown").default("markdown"),
        outputDir: z.string().min(1).default("docpup-build"),
      })
      .optional(),
    scan: scanSchema,
    contentType: z.enum(["docs", "source"]).optional(),
  })
  .refine((data) => data.sourcePath || data.sourcePaths, {
    message: "Either sourcePath or sourcePaths must be provided",
  })
  .refine(
    (data) => !(data.preprocess && data.sourcePaths && data.sourcePaths.length > 1),
    {
      message: "preprocess is not supported with multiple sourcePaths",
    }
  );

const configSchema = z.object({
  docsDir: z.string().min(1).default("documentation"),
  indicesDir: z.string().min(1).default("documentation/indices"),
  gitignore: gitignoreSchema,
  scan: scanSchema,
  repos: z.array(repoSchema).min(1),
  concurrency: z.number().int().positive().optional(),
});

export async function loadConfig(
  configPath?: string,
  baseDir: string = process.cwd()
): Promise<{ config: DocpupConfig; configDir: string }> {
  const explorer = cosmiconfig("docpup", {
    searchPlaces: [
      "docpup.config.yaml",
      "docpup.config.yml",
      ".docpuprc",
      ".docpuprc.json",
      ".docpuprc.yaml",
      ".docpuprc.yml",
    ],
  });

  const resolvedPath = configPath
    ? path.resolve(baseDir, configPath)
    : undefined;
  const result = resolvedPath
    ? await explorer.load(resolvedPath)
    : await explorer.search(baseDir);

  if (!result || result.isEmpty) {
    throw new Error(
      configPath
        ? `No config found at ${resolvedPath}`
        : "No docpup config found. Expected docpup.config.yaml or .docpuprc.*"
    );
  }

  const parsed = configSchema.safeParse(result.config);
  if (!parsed.success) {
    throw new Error(`Invalid config: ${parsed.error.message}`);
  }

  const mergedConfig: DocpupConfig = {
    ...parsed.data,
    gitignore: {
      ...defaultGitignore,
      ...parsed.data.gitignore,
    },
    scan: {
      ...defaultScan,
      ...parsed.data.scan,
    },
  };

  return {
    config: mergedConfig,
    configDir: path.dirname(result.filepath),
  };
}
