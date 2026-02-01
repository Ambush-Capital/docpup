import { cosmiconfig } from "cosmiconfig";
import { z } from "zod";
import path from "node:path";
import type { DocpupConfig } from "./types.js";

const RepoConfigSchema = z.object({
  name: z.string().min(1),
  repo: z.string().url(),
  sourcePath: z.string().min(1),
  ref: z.string().optional(),
});

const defaultGitignoreConfig = {
  addDocsDir: true,
  addIndexFiles: false,
  sectionHeader: "Docpup generated docs",
};

const defaultScanConfig = {
  includeMd: true,
  includeMdx: true,
  excludeDirs: ["node_modules", "images", "img", "media", "assets", "css", "fonts"],
};

const GitignoreConfigSchema = z
  .object({
    addDocsDir: z.boolean().optional(),
    addIndexFiles: z.boolean().optional(),
    sectionHeader: z.string().optional(),
  })
  .optional()
  .transform((val) => ({ ...defaultGitignoreConfig, ...val }));

const ScanConfigSchema = z
  .object({
    includeMd: z.boolean().optional(),
    includeMdx: z.boolean().optional(),
    excludeDirs: z.array(z.string()).optional(),
  })
  .optional()
  .transform((val) => ({ ...defaultScanConfig, ...val }));

const DocpupConfigSchema = z.object({
  docsDir: z.string().default("documentation"),
  indicesDir: z.string().default("documentation/indices"),
  gitignore: GitignoreConfigSchema,
  scan: ScanConfigSchema,
  repos: z.array(RepoConfigSchema).min(1),
  concurrency: z.number().int().positive().default(2),
});

export async function loadConfig(
  configPath?: string
): Promise<{ config: DocpupConfig; configDir: string }> {
  const explorer = cosmiconfig("docpup", {
    searchPlaces: [
      "docpup.config.yaml",
      "docpup.config.yml",
      "docpup.config.json",
      ".docpuprc",
      ".docpuprc.yaml",
      ".docpuprc.yml",
      ".docpuprc.json",
    ],
  });

  const result = configPath
    ? await explorer.load(configPath)
    : await explorer.search();

  if (!result || result.isEmpty) {
    throw new Error(
      "No docpup configuration found. Create a docpup.config.yaml file."
    );
  }

  const parsed = DocpupConfigSchema.safeParse(result.config);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  const configDir = path.dirname(result.filepath);

  return {
    config: parsed.data as DocpupConfig,
    configDir,
  };
}
