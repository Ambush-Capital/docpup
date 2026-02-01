import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { createRequire } from "node:module";
import ora from "ora";
import pLimit from "p-limit";
import { loadConfig } from "./config.js";
import { sparseCheckoutRepo } from "./git.js";
import { scanDocs } from "./scanner.js";
import { buildIndex } from "./indexer.js";
import { updateGitignore } from "./gitignore.js";
import type { DocpupConfig, RepoConfig } from "./types.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

function toPosix(input: string) {
  return input.split(path.sep).join("/");
}

function withTrailingSlash(input: string) {
  return input.endsWith("/") ? input : `${input}/`;
}

function parseOnly(only?: string) {
  if (!only) return [];
  return only
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

async function copyDocs(
  sourceRoot: string,
  targetRoot: string,
  tree: Map<string, string[]>
) {
  for (const [dir, files] of tree.entries()) {
    const sourceDir = dir ? path.join(sourceRoot, dir) : sourceRoot;
    const targetDir = dir ? path.join(targetRoot, dir) : targetRoot;
    await fs.mkdir(targetDir, { recursive: true });

    for (const file of files) {
      await fs.copyFile(path.join(sourceDir, file), path.join(targetDir, file));
    }
  }
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
  const { config } = await loadConfig(options.config);
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

  let gitignoreQueue = Promise.resolve();
  const gitignoreConfig = config.gitignore;

  const warn = (message: string) => {
    if (spinner.isSpinning) {
      spinner.stop();
    }
    console.warn(message);
    spinner.start();
  };

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
        const checkout = await sparseCheckoutRepo({
          repoUrl: repo.repo,
          sourcePath: repo.sourcePath,
          ref: repo.ref,
          tempDir,
        });

        if (!checkout.ok) {
          failed += 1;
          failures.push({ name: repo.name, error: checkout.error });
          warn(`Warning: failed to clone ${repo.name}: ${checkout.error}`);
          return;
        }

        const tree = await scanDocs(checkout.checkoutPath, config.scan);
        const outputRepoDir = path.join(docsRoot, repo.name);
        await fs.rm(outputRepoDir, { recursive: true, force: true });
        await fs.mkdir(outputRepoDir, { recursive: true });
        await copyDocs(checkout.checkoutPath, outputRepoDir, tree);

        const docsRootRelPath = toPosix(
          path.relative(repoRoot, outputRepoDir)
        );
        const indexContents = buildIndex(tree, repo.name, docsRootRelPath);
        const indexFilePath = path.join(
          indicesRoot,
          `${repo.name}-index.md`
        );
        await fs.mkdir(path.dirname(indexFilePath), { recursive: true });
        await fs.writeFile(indexFilePath, indexContents);

        if (gitignoreConfig.addDocsDir || gitignoreConfig.addIndexFiles) {
          const docsEntry = gitignoreConfig.addDocsDir
            ? withTrailingSlash(docsRootRelPath)
            : undefined;
          const indexEntry = gitignoreConfig.addIndexFiles
            ? toPosix(path.relative(repoRoot, indexFilePath))
            : undefined;

          gitignoreQueue = gitignoreQueue
            .then(() =>
              updateGitignore({
                repoRoot,
                docsEntry,
                indexEntry,
                sectionHeader: gitignoreConfig.sectionHeader,
              })
            )
            .catch((error) => {
              warn(
                `Warning: failed to update .gitignore for ${repo.name}: ${error instanceof Error ? error.message : String(error)}`
              );
            });
        }

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
