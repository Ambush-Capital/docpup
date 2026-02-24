import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import * as cheerio from "cheerio";
import type { RepoConfig } from "./types.js";
import { resolveInside } from "./utils.js";

type HtmlPreprocessConfig = Extract<RepoConfig["preprocess"], { type: "html" }>;

type SphinxPreprocessConfig = Extract<RepoConfig["preprocess"], { type: "sphinx" }>;

function getSingleSourcePath(repo: RepoConfig): string {
  if (repo.sourcePaths && repo.sourcePaths.length > 0) {
    if (repo.sourcePaths.length > 1) {
      throw new Error(
        `Repo ${repo.name}: preprocess requires a single sourcePath`
      );
    }
    return repo.sourcePaths[0];
  }
  if (repo.sourcePath) {
    return repo.sourcePath;
  }
  throw new Error(`Repo ${repo.name}: either sourcePath or sourcePaths required`);
}

async function runSphinxPreprocess(
  checkoutRoot: string,
  repo: RepoConfig,
  preprocess: SphinxPreprocessConfig
): Promise<string> {
  const builder = preprocess.builder ?? "markdown";
  if (builder !== "markdown") {
    throw new Error(
      `Unsupported sphinx builder: ${builder}. Only "markdown" is allowed.`
    );
  }

  const workDir = preprocess.workDir ?? getSingleSourcePath(repo);
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
    const combinedRaw = `${stderr}\n${message}`;
    const combined = combinedRaw.toLowerCase();

    if (err?.code === "ENOENT" || combined.includes("enoent")) {
      return 'Python not found. Install Python 3 and ensure "python" is on PATH.';
    }

    const missingModuleMatch = combinedRaw.match(
      /no module named\s+['\"]?([A-Za-z0-9_.-]+)['\"]?/i
    );
    if (missingModuleMatch?.[1]) {
      const missingModule = missingModuleMatch[1].toLowerCase();

      if (missingModule === "sphinx" || missingModule.startsWith("sphinx.")) {
        return "Sphinx is not installed. Run: python -m pip install sphinx sphinx-markdown-builder";
      }

      if (
        missingModule === "sphinx_markdown_builder" ||
        missingModule.startsWith("sphinx_markdown_builder.")
      ) {
        return "Markdown builder is unavailable. Install sphinx-markdown-builder and ensure it is accessible to Sphinx.";
      }

      if (missingModule.startsWith("sphinx")) {
        return `A Sphinx dependency appears to be missing (${missingModuleMatch[1]}). Install it in the same Python environment used by "python".`;
      }
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

function rewriteHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (trimmed.startsWith("//")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return null;

  const hashIndex = trimmed.indexOf("#");
  const hash = hashIndex >= 0 ? trimmed.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;

  const queryIndex = withoutHash.indexOf("?");
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex) : "";
  const pathPart = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;

  if (!pathPart) return null;

  const lower = pathPart.toLowerCase();
  const ext = lower.endsWith(".html") ? ".html" : lower.endsWith(".htm") ? ".htm" : null;
  if (ext) {
    return `${pathPart.slice(0, -ext.length)}.md${query}${hash}`;
  }

  return null;
}

export function createTurndownService(): TurndownService {
  const turndown = new TurndownService({
    codeBlockStyle: "fenced",
    headingStyle: "atx",
  });
  turndown.use(gfm);
  return turndown;
}

export function selectContent(
  $: cheerio.CheerioAPI,
  selector?: string
): cheerio.Cheerio<cheerio.AnyNode> {
  if (selector) {
    const provided = $(selector).first();
    if (provided.length > 0) return provided;
  }

  const candidates = ["main", "article", "#content", ".content", ".document", "body"];
  for (const candidate of candidates) {
    const found = $(candidate).first();
    if (found.length > 0) return found;
  }

  return $("body").first();
}

async function collectHtmlFiles(rootDir: string, skipDir?: string): Promise<string[]> {
  const results: string[] = [];
  const resolvedSkip = skipDir ? path.resolve(skipDir) : null;

  const shouldSkipDir = (dirPath: string): boolean => {
    if (!resolvedSkip) return false;
    const relative = path.relative(resolvedSkip, dirPath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };

  async function walk(current: string) {
    if (shouldSkipDir(current)) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) {
          continue;
        }
        await walk(path.join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".html" || ext === ".htm") {
        results.push(path.join(current, entry.name));
      }
    }
  }

  await walk(rootDir);
  return results;
}

async function runHtmlPreprocess(
  checkoutRoot: string,
  repo: RepoConfig,
  preprocess: HtmlPreprocessConfig
): Promise<string> {
  const workDir = preprocess.workDir ?? getSingleSourcePath(repo);
  const outputDir = preprocess.outputDir ?? "docpup-build";
  const selector = preprocess.selector?.trim();
  const rewriteLinks = preprocess.rewriteLinks ?? true;

  const resolvedWorkDir = resolveInside(checkoutRoot, workDir);
  const resolvedOutputDir = resolveInside(checkoutRoot, outputDir);

  const workDirStat = await fs.stat(resolvedWorkDir).catch(() => null);
  if (!workDirStat || !workDirStat.isDirectory()) {
    throw new Error(`HTML workDir not found: ${resolvedWorkDir}`);
  }

  await fs.rm(resolvedOutputDir, { recursive: true, force: true });
  await fs.mkdir(resolvedOutputDir, { recursive: true });

  const htmlFiles = await collectHtmlFiles(resolvedWorkDir, resolvedOutputDir);
  if (htmlFiles.length === 0) {
    throw new Error(
      `HTML preprocess produced no markdown files for ${repo.name}. Check workDir and outputDir.`
    );
  }

  const turndown = createTurndownService();

  let written = 0;

  for (const filePath of htmlFiles) {
    const raw = await fs.readFile(filePath, "utf8");
    const $ = cheerio.load(raw);
    const selection = selectContent($, selector);

    selection.find("script,style").remove();

    if (rewriteLinks) {
      const anchors = selection
        .find("a[href]")
        .add(selection.filter("a[href]"));
      anchors.each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        const rewritten = rewriteHref(href);
        if (rewritten) {
          $(el).attr("href", rewritten);
        }
      });
    }

    const htmlSource = selection.html() ?? "";
    const markdown = turndown.turndown(htmlSource);

    const relativePath = path.relative(resolvedWorkDir, filePath);
    const parsed = path.parse(relativePath);
    const targetPath = path.join(
      resolvedOutputDir,
      parsed.dir,
      `${parsed.name}.md`
    );

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, markdown, "utf8");
    written += 1;
  }

  if (written === 0) {
    throw new Error(
      `HTML preprocess produced no markdown files for ${repo.name}. Check workDir and outputDir.`
    );
  }

  return resolvedOutputDir;
}

export async function runPreprocess(
  checkoutRoot: string,
  repo: RepoConfig
): Promise<string> {
  const preprocess = repo.preprocess;
  if (!preprocess) return checkoutRoot;

  if (preprocess.type === "sphinx") {
    return runSphinxPreprocess(checkoutRoot, repo, preprocess);
  }

  if (preprocess.type === "html") {
    return runHtmlPreprocess(checkoutRoot, repo, preprocess);
  }

  throw new Error(`Unsupported preprocess type: ${preprocess.type}`);
}
