import { Command } from "commander";
import ora from "ora";
import pLimit from "p-limit";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { loadConfig } from "./config.js";
import { sparseCheckoutRepo, cleanupTempDir } from "./git.js";
import { scanDocs } from "./scanner.js";
import { buildIndex } from "./indexer.js";
import { updateGitignore } from "./gitignore.js";
import type { RepoConfig, DocpupConfig } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(__dirname, "..", "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
const version: string = packageJson.version;

interface ProcessResult {
  name: string;
  success: boolean;
  error?: string;
  filesCount?: number;
}

async function processRepo(
  repo: RepoConfig,
  config: DocpupConfig,
  configDir: string,
  index: number,
  total: number
): Promise<ProcessResult> {
  const spinner = ora({
    text: `Processing ${index + 1}/${total}: ${repo.name}`,
    prefixText: "",
  }).start();

  const docsDir = path.resolve(configDir, config.docsDir);
  const indicesDir = path.resolve(configDir, config.indicesDir);
  const repoDocsDir = path.join(docsDir, repo.name);
  const indexFilePath = path.join(indicesDir, `${repo.name}-index.md`);

  try {
    spinner.text = `Processing ${index + 1}/${total}: ${repo.name} - cloning`;

    const checkoutResult = await sparseCheckoutRepo({
      repoUrl: repo.repo,
      sourcePath: repo.sourcePath,
      ref: repo.ref,
    });

    if (!checkoutResult.success) {
      spinner.fail(`${repo.name}: ${checkoutResult.error}`);
      return { name: repo.name, success: false, error: checkoutResult.error };
    }

    const tempDocsPath = checkoutResult.path;

    try {
      spinner.text = `Processing ${index + 1}/${total}: ${repo.name} - scanning`;

      const tree = await scanDocs(tempDocsPath, config.scan);

      if (tree.size === 0) {
        spinner.warn(`${repo.name}: No markdown files found`);
        await cleanupTempDir(tempDocsPath);
        return { name: repo.name, success: true, filesCount: 0 };
      }

      spinner.text = `Processing ${index + 1}/${total}: ${repo.name} - copying`;

      await rm(repoDocsDir, { recursive: true, force: true });
      await mkdir(repoDocsDir, { recursive: true });

      for (const [relDir, files] of tree) {
        const srcDir = relDir === "(root)" ? tempDocsPath : path.join(tempDocsPath, relDir);
        const destDir = relDir === "(root)" ? repoDocsDir : path.join(repoDocsDir, relDir);

        await mkdir(destDir, { recursive: true });

        for (const file of files) {
          await cp(path.join(srcDir, file), path.join(destDir, file));
        }
      }

      spinner.text = `Processing ${index + 1}/${total}: ${repo.name} - indexing`;

      const docsRelPath = path.join(config.docsDir, repo.name);
      const indexContent = buildIndex(tree, repo.name, docsRelPath);

      await mkdir(indicesDir, { recursive: true });
      await writeFile(indexFilePath, indexContent, "utf-8");

      const totalFiles = Array.from(tree.values()).reduce((sum, files) => sum + files.length, 0);

      spinner.succeed(`${repo.name}: ${totalFiles} files indexed`);

      return { name: repo.name, success: true, filesCount: totalFiles };
    } finally {
      await cleanupTempDir(tempDocsPath);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    spinner.fail(`${repo.name}: ${message}`);
    return { name: repo.name, success: false, error: message };
  }
}

async function generate(options: {
  config?: string;
  only?: string[];
  concurrency?: number;
}): Promise<void> {
  const spinner = ora("Loading configuration").start();

  let config: DocpupConfig;
  let configDir: string;

  try {
    const result = await loadConfig(options.config);
    config = result.config;
    configDir = result.configDir;
    spinner.succeed("Configuration loaded");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    spinner.fail(`Configuration error: ${message}`);
    process.exit(1);
  }

  let repos = config.repos;

  if (options.only && options.only.length > 0) {
    const onlySet = new Set(options.only);
    repos = repos.filter((r) => onlySet.has(r.name));

    if (repos.length === 0) {
      console.error(`No repos matched the filter: ${options.only.join(", ")}`);
      process.exit(1);
    }
  }

  const concurrency = options.concurrency ?? config.concurrency ?? 2;
  const limit = pLimit(concurrency);

  console.log(`\nProcessing ${repos.length} repo(s) with concurrency ${concurrency}\n`);

  const tasks = repos.map((repo, index) =>
    limit(() => processRepo(repo, config, configDir, index, repos.length))
  );

  const results = await Promise.all(tasks);

  const gitignoreEntries: string[] = [];
  const docsDir = path.resolve(configDir, config.docsDir);
  const indicesDir = path.resolve(configDir, config.indicesDir);

  for (const result of results) {
    if (result.success) {
      if (config.gitignore.addDocsDir) {
        const relDocsDir = path.relative(configDir, path.join(docsDir, result.name));
        gitignoreEntries.push(`${relDocsDir}/`);
      }
      if (config.gitignore.addIndexFiles) {
        const relIndexFile = path.relative(
          configDir,
          path.join(indicesDir, `${result.name}-index.md`)
        );
        gitignoreEntries.push(relIndexFile);
      }
    }
  }

  if (gitignoreEntries.length > 0) {
    await updateGitignore({
      repoRoot: configDir,
      entries: gitignoreEntries,
      sectionHeader: config.gitignore.sectionHeader,
    });
  }

  console.log("");

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length > 0) {
    const totalFiles = successful.reduce((sum, r) => sum + (r.filesCount ?? 0), 0);
    console.log(`Completed: ${successful.length} repo(s), ${totalFiles} files total`);
  }

  if (failed.length > 0) {
    console.log(`\nFailed: ${failed.length} repo(s)`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
  }
}

const program = new Command();

program
  .name("docpup")
  .description("Clone GitHub documentation and generate AGENTS.md indexes")
  .version(version);

program
  .command("generate", { isDefault: true })
  .description("Generate documentation and indexes from configured repos")
  .option("-c, --config <path>", "Path to config file")
  .option(
    "-o, --only <names...>",
    "Process only these repos (space-separated names)"
  )
  .option(
    "--concurrency <number>",
    "Number of repos to process in parallel",
    (val) => parseInt(val, 10)
  )
  .action(generate);

program.parse();
