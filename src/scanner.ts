import fs from "node:fs/promises";
import path from "node:path";
import type { DocpupConfig } from "./types.js";

function toPosix(input: string) {
  return input.split(path.sep).join("/");
}

function buildExtensionSet(scanConfig: DocpupConfig["scan"]): Set<string> {
  const includeExts = new Set<string>();

  // Custom extensions take precedence
  if (scanConfig.extensions && scanConfig.extensions.length > 0) {
    for (const ext of scanConfig.extensions) {
      includeExts.add(ext.toLowerCase());
    }
  } else {
    // Legacy behavior
    if (scanConfig.includeMd) includeExts.add(".md");
    if (scanConfig.includeMdx) includeExts.add(".mdx");
  }

  return includeExts;
}

export async function scanDocs(
  rootPath: string,
  scanConfig: DocpupConfig["scan"]
): Promise<Map<string, string[]>> {
  const rootStat = await fs.stat(rootPath).catch(() => null);

  // Handle single file case
  if (rootStat?.isFile()) {
    const includeExts = buildExtensionSet(scanConfig);
    const ext = path.extname(rootPath).toLowerCase();
    if (includeExts.has(ext)) {
      const fileName = path.basename(rootPath);
      return new Map([["", [fileName]]]);
    }
    return new Map();
  }

  if (!rootStat?.isDirectory()) {
    throw new Error(`Path not found: ${rootPath}`);
  }

  const includeExts = buildExtensionSet(scanConfig);
  const excludeDirs = new Set(scanConfig.excludeDirs);
  const tree = new Map<string, string[]>();

  async function walk(currentDir: string, relativeDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") && !scanConfig.includeHiddenDirs) {
          continue;
        }
        if (excludeDirs.has(entry.name)) {
          continue;
        }
        const nextDir = path.join(currentDir, entry.name);
        const nextRel = toPosix(path.join(relativeDir, entry.name));
        await walk(nextDir, nextRel);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!includeExts.has(ext)) {
        continue;
      }

      files.push(entry.name);
    }

    if (files.length > 0) {
      files.sort((a, b) => a.localeCompare(b));
      tree.set(relativeDir, files);
    }
  }

  await walk(rootPath, "");
  return tree;
}

export async function scanMultiplePaths(
  paths: string[],
  scanConfig: DocpupConfig["scan"],
  baseDir?: string
): Promise<Map<string, string[]>> {
  const combined = new Map<string, string[]>();

  for (const p of paths) {
    const tree = await scanDocs(p, scanConfig);

    // Calculate the relative prefix from baseDir to this path
    let prefix = "";
    if (baseDir) {
      const stat = await fs.stat(p).catch(() => null);
      if (stat?.isFile()) {
        // For files, get the directory containing the file relative to baseDir
        const fileDir = path.dirname(p);
        prefix = toPosix(path.relative(baseDir, fileDir));
      } else {
        prefix = toPosix(path.relative(baseDir, p));
      }
    }

    for (const [dir, files] of tree) {
      // Combine prefix with the directory from the scan
      let fullDir = dir;
      if (prefix && prefix !== ".") {
        fullDir = dir ? `${prefix}/${dir}` : prefix;
      }

      const existing = combined.get(fullDir) || [];
      const merged = [...new Set([...existing, ...files])].sort((a, b) =>
        a.localeCompare(b)
      );
      combined.set(fullDir, merged);
    }
  }

  return combined;
}
