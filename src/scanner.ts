import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { DocTree, ScanConfig } from "./types.js";

export async function scanDocs(
  rootPath: string,
  scanConfig: ScanConfig
): Promise<DocTree> {
  const tree: DocTree = new Map();
  const { includeMd, includeMdx, excludeDirs } = scanConfig;

  const excludeSet = new Set(excludeDirs.map((d) => d.toLowerCase()));

  async function walk(currentPath: string, relativePath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    const files: string[] = [];

    for (const entry of entries) {
      const entryName = entry.name;

      if (entry.isDirectory()) {
        if (excludeSet.has(entryName.toLowerCase())) {
          continue;
        }
        if (entryName.startsWith(".")) {
          continue;
        }

        const nextPath = path.join(currentPath, entryName);
        const nextRelative = relativePath
          ? path.join(relativePath, entryName)
          : entryName;

        await walk(nextPath, nextRelative);
      } else if (entry.isFile()) {
        const ext = path.extname(entryName).toLowerCase();

        if (ext === ".md" && includeMd) {
          files.push(entryName);
        } else if (ext === ".mdx" && includeMdx) {
          files.push(entryName);
        }
      }
    }

    if (files.length > 0) {
      files.sort((a, b) => a.localeCompare(b));
      const dirKey = relativePath || "(root)";
      tree.set(dirKey, files);
    }
  }

  try {
    const stats = await stat(rootPath);
    if (!stats.isDirectory()) {
      return tree;
    }
  } catch {
    return tree;
  }

  await walk(rootPath, "");

  return tree;
}
