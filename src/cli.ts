import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { createRequire } from "node:module";
import ora from "ora";
import pLimit from "p-limit";
import { execa } from "execa";
import { loadConfig } from "./config.js";
import { sparseCheckoutRepo } from "./git.js";
import { scanDocs, scanMultiplePaths } from "./scanner.js";
import { buildIndex } from "./indexer.js";
import { updateGitignore } from "./gitignore.js";
import type { DocpupConfig, RepoConfig } from "./types.js";

function normalizeSourcePaths(repo: RepoConfig): string[] {
  if (repo.sourcePaths && repo.sourcePaths.length > 0) {
    return repo.sourcePaths;
  }
  if (repo.sourcePath) {
    return [repo.sourcePath];
  }
  throw new Error(`Repo ${repo.name}: either sourcePath or sourcePaths required`);
}

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

function toPosix(input: string) {
  return input.split(path.sep).join("/");
}

function withTrailingSlash(input: string) {
  return input.endsWith("/") ? input : `${input}/`;
}

function toGitignoreDirEntry(root: string, targetDir: string) {
  const relative = toPosix(path.relative(root, targetDir)).replace(/^\.\/+/, "");
  if (!relative || relative === ".") {
    return undefined;
  }
  return withTrailingSlash(relative);
}

function resolveInside(root: string, ...segments: string[]) {
  const resolved = path.resolve(root, ...segments);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Resolved path escapes root: ${resolved}`);
  }
  return resolved;
}

function parseOnly(only?: string) {
  if (!only) return [];
  return only
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

export function mergeScanConfig(
  base: DocpupConfig["scan"],
  overrides?: Partial<DocpupConfig["scan"]>
): DocpupConfig["scan"] {
  if (!overrides) return base;
  const mergedExcludeDirs = overrides.excludeDirs
    ? Array.from(new Set([...base.excludeDirs, ...overrides.excludeDirs]))
    : base.excludeDirs;
  return {
    ...base,
    ...overrides,
    excludeDirs: mergedExcludeDirs,
  };
}

async function copyDocs(
  sourceRoot: string,
  targetRoot: string,
  tree: Map<string, string[]>,
  isSingleFile = false
) {
  if (isSingleFile) {
    // sourceRoot is a file path, not a directory
    const fileName = path.basename(sourceRoot);
    await fs.mkdir(targetRoot, { recursive: true });
    await fs.copyFile(sourceRoot, path.join(targetRoot, fileName));
    return;
  }

  for (const [dir, files] of tree.entries()) {
    const sourceDir = dir ? path.join(sourceRoot, dir) : sourceRoot;
    const targetDir = dir ? path.join(targetRoot, dir) : targetRoot;
    await fs.mkdir(targetDir, { recursive: true });

    for (const file of files) {
      await fs.copyFile(path.join(sourceDir, file), path.join(targetDir, file));
    }
  }
}

async function runSphinxPreprocess(
  checkoutRoot: string,
  repo: RepoConfig
): Promise<string> {
  const preprocess = repo.preprocess;
  if (!preprocess) {
    return checkoutRoot;
  }

  // Preprocess types are intentionally narrow today; extend this switch
  // when new preprocessors are added.
  if (preprocess.type !== "sphinx") {
    throw new Error(`Unsupported preprocess type: ${preprocess.type}`);
  }

  const builder = preprocess.builder ?? "markdown";
  if (builder !== "markdown") {
    throw new Error(
      `Unsupported sphinx builder: ${builder}. Only "markdown" is allowed.`
    );
  }

  const workDir = preprocess.workDir ?? repo.sourcePath;
  const outputDir = preprocess.outputDir ?? "docpup-build";
  const resolvedWorkDir = resolveInside(checkoutRoot, workDir);
  const resolvedOutputDir = resolveInside(checkoutRoot, outputDir);

  const workDirStat = await fs.stat(resolvedWorkDir).catch(() => null);
  if (!workDirStat || !workDirStat.isDirectory()) {
    throw new Error(`Sphinx workDir not found: ${resolvedWorkDir}`);
  }

  await fs.rm(resolvedOutputDir, { recursive: true, force: true });
  await fs.mkdir(resolvedOutputDir, { recursive: true });

  const workDirArg = path.relative(checkoutRoot, resolvedWorkDir) || ".";
  const outputDirArg = path.relative(checkoutRoot, resolvedOutputDir) || ".";

  const formatSphinxFailure = (error: unknown): string => {
    const err = error as { code?: string; stderr?: string };
    const message = error instanceof Error ? error.message : String(error);
    const stderr = err?.stderr ?? "";
    const combined = `${stderr}\n${message}`.toLowerCase();

    if (err?.code === "ENOENT" || combined.includes("enoent")) {
      return 'Python not found. Install Python 3 and ensure "python" is on PATH.';
    }

    if (
      combined.includes("no module named") &&
      (combined.includes("sphinx") || combined.includes("sphinx_markdown_builder"))
    ) {
      return "Sphinx is not installed. Run: python -m pip install sphinx sphinx-markdown-builder";
    }

    if (combined.includes("builder name") && combined.includes("markdown")) {
      return "Markdown builder is unavailable. Install sphinx-markdown-builder and ensure it is accessible to Sphinx.";
    }

    return message;
  };

  try {
    await execa(
      "python",
      ["-m", "sphinx", "-b", "markdown", workDirArg, outputDirArg],
      {
        cwd: checkoutRoot,
        stdin: "ignore",
      }
    );
  } catch (error) {
    const detail = formatSphinxFailure(error);
    throw new Error(`Sphinx preprocess failed for ${repo.name}: ${detail}`);
  }

  return resolvedOutputDir;
}

export type GenerateOptions = {
  config?: string;
  only?: string;
  concurrency?: number;
  cwd?: string;
};

export type GenerateSummary = {
  total: number;
  succeeded: number;
  failed: number;
  failures: { name: string; error: string }[];
};

export async function generateDocs(
  options: GenerateOptions
): Promise<GenerateSummary> {
  const repoRoot = options.cwd ?? process.cwd();
  const { config } = await loadConfig(options.config, repoRoot);
  const onlyNames = parseOnly(options.only);

  let repos = config.repos;
  if (onlyNames.length > 0) {
    const onlySet = new Set(onlyNames);
    repos = repos.filter((repo) => onlySet.has(repo.name));
  }

  if (repos.length === 0) {
    throw new Error("No repos matched the provided filter.");
  }

  const concurrencyInput = options.concurrency ?? config.concurrency ?? 2;
  const parsedConcurrency = Number(concurrencyInput);
  const concurrency =
    Number.isFinite(parsedConcurrency) && parsedConcurrency > 0
      ? parsedConcurrency
      : 2;
  const limit = pLimit(concurrency);

  const docsRoot = path.resolve(repoRoot, config.docsDir);
  const indicesRoot = path.resolve(repoRoot, config.indicesDir);
  await fs.mkdir(docsRoot, { recursive: true });
  await fs.mkdir(indicesRoot, { recursive: true });

  const spinner = ora(`Processing 0/${repos.length}...`).start();
  let started = 0;
  let completed = 0;
  let succeeded = 0;
  let failed = 0;
  const failures: { name: string; error: string }[] = [];

  const warn = (message: string) => {
    if (spinner.isSpinning) {
      spinner.stop();
    }
    console.warn(message);
    spinner.start();
  };

  let gitignoreQueue = Promise.resolve();
  const gitignoreConfig = config.gitignore;
  const docsIgnoreEntry = gitignoreConfig.addDocsDir
    ? toGitignoreDirEntry(repoRoot, docsRoot)
    : undefined;
  const indexIgnoreEntry = gitignoreConfig.addIndexFiles
    ? toGitignoreDirEntry(repoRoot, indicesRoot)
    : undefined;

  if (docsIgnoreEntry || indexIgnoreEntry) {
    gitignoreQueue = updateGitignore({
      repoRoot,
      docsEntry: docsIgnoreEntry,
      indexEntry: indexIgnoreEntry,
      sectionHeader: gitignoreConfig.sectionHeader,
    }).catch((error) => {
      warn(
        `Warning: failed to update .gitignore: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }

  const updateProgress = (repoName?: string) => {
    const progressLabel = repoName
      ? `Processing ${started}/${repos.length}: ${repoName}`
      : `Completed ${completed}/${repos.length}`;
    spinner.text = progressLabel;
  };

  const tasks = repos.map((repo) =>
    limit(async () => {
      started += 1;
      updateProgress(repo.name);

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docpup-"));
      try {
        const sourcePaths = normalizeSourcePaths(repo);
        const checkout = await sparseCheckoutRepo({
          repoUrl: repo.repo,
          sourcePaths,
          ref: repo.ref,
          tempDir,
        });

        if (!checkout.ok) {
          failed += 1;
          failures.push({ name: repo.name, error: checkout.error });
          warn(`Warning: failed to clone ${repo.name}: ${checkout.error}`);
          return;
        }

        const scanConfig = mergeScanConfig(config.scan, repo.scan);
        let tree: Map<string, string[]>;

        if (repo.preprocess) {
          // Preprocess only works with single path
          const scanRoot = await runSphinxPreprocess(tempDir, repo);
          tree = await scanDocs(scanRoot, scanConfig);
          if (tree.size === 0) {
            throw new Error(
              `Sphinx preprocess produced no markdown files for ${repo.name}. Check builder output and scan settings.`
            );
          }
          const outputRepoDir = resolveInside(docsRoot, repo.name);
          await fs.rm(outputRepoDir, { recursive: true, force: true });
          await fs.mkdir(outputRepoDir, { recursive: true });
          await copyDocs(scanRoot, outputRepoDir, tree);
        } else {
          // Scan and copy from multiple paths
          tree = await scanMultiplePaths(checkout.checkoutPaths, scanConfig, tempDir);
          const outputRepoDir = resolveInside(docsRoot, repo.name);
          await fs.rm(outputRepoDir, { recursive: true, force: true });
          await fs.mkdir(outputRepoDir, { recursive: true });

          // Copy from each checkout path preserving relative structure
          for (const checkoutPath of checkout.checkoutPaths) {
            const relativePath = path.relative(tempDir, checkoutPath);
            const pathTree = await scanDocs(checkoutPath, scanConfig);
            if (pathTree.size > 0) {
              const targetDir =
                relativePath && relativePath !== "."
                  ? path.join(outputRepoDir, relativePath)
                  : outputRepoDir;
              // Detect if checkoutPath is a single file
              const pathStat = await fs.stat(checkoutPath);
              const isSingleFile = pathStat.isFile();
              if (isSingleFile) {
                // For single files, the targetDir should be the parent directory
                const parentDir = path.dirname(targetDir);
                await copyDocs(checkoutPath, parentDir, pathTree, true);
              } else {
                await copyDocs(checkoutPath, targetDir, pathTree);
              }
            }
          }
        }

        const outputRepoDir = resolveInside(docsRoot, repo.name);
        const docsRootRelPath = toPosix(
          path.relative(repoRoot, outputRepoDir)
        );
        const contentType = repo.contentType ?? "docs";
        const indexContents = buildIndex(tree, repo.name, docsRootRelPath, contentType);
        const indexFilePath = resolveInside(
          indicesRoot,
          `${repo.name}-index.md`
        );
        await fs.mkdir(path.dirname(indexFilePath), { recursive: true });
        await fs.writeFile(indexFilePath, indexContents);

        succeeded += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ name: repo.name, error: message });
        warn(`Warning: failed to process ${repo.name}: ${message}`);
      } finally {
        completed += 1;
        updateProgress();
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    })
  );

  await Promise.all(tasks);
  await gitignoreQueue;

  spinner.succeed(
    `Processed ${repos.length} repos (${succeeded} succeeded, ${failed} failed).`
  );

  return {
    total: repos.length,
    succeeded,
    failed,
    failures,
  };
}

async function main() {
  const program = new Command();

  program
    .name("docpup")
    .description("Clone docs from GitHub repos and build compact indices.")
    .version(packageJson.version);

  program
    .command("generate", { isDefault: true })
    .description("Generate documentation indices from configured repositories.")
    .option("-c, --config <path>", "Path to docpup config file")
    .option(
      "--only <names>",
      "Comma-separated repo names to process (e.g. nextjs,axum)"
    )
    .option("--concurrency <number>", "Number of repos to process in parallel")
    .action(async (options: GenerateOptions) => {
      try {
        await generateDocs({
          config: options.config,
          only: options.only,
          concurrency:
            options.concurrency !== undefined
              ? Number(options.concurrency)
              : undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exitCode = 1;
      }
    });

  await program.parseAsync(process.argv);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
