import fs from "node:fs/promises";
import path from "node:path";
import type { DocpupConfig } from "./types.js";

function toPosix(input: string) {
  return input.split(path.sep).join("/");
}

export async function scanDocs(
  rootPath: string,
  scanConfig: DocpupConfig["scan"]
): Promise<Map<string, string[]>> {
  const rootStat = await fs.stat(rootPath).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`Docs source path not found: ${rootPath}`);
  }

  const includeExts = new Set<string>();
  if (scanConfig.includeMd) includeExts.add(".md");
  if (scanConfig.includeMdx) includeExts.add(".mdx");

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
