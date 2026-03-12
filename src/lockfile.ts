import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DocpupConfig, RepoConfig } from "./types.js";

export type DocpupLockRepoEntry = {
  name: string;
  repoUrl: string;
  requestedRef?: string;
  resolvedRef: string;
  commitSha: string;
  processingHash: string;
};

export type DocpupLockfile = {
  version: 1;
  repos: Record<string, DocpupLockRepoEntry>;
};

export function getLockfilePath(repoRoot: string) {
  return path.join(repoRoot, "docpup-lock.json");
}

export async function loadLockfile(repoRoot: string): Promise<DocpupLockfile> {
  const lockfilePath = getLockfilePath(repoRoot);
  const raw = await fs.readFile(lockfilePath, "utf8").catch(() => undefined);
  if (!raw) {
    return { version: 1, repos: {} };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DocpupLockfile>;
    if (parsed.version !== 1 || !parsed.repos || typeof parsed.repos !== "object") {
      return { version: 1, repos: {} };
    }
    return {
      version: 1,
      repos: parsed.repos as Record<string, DocpupLockRepoEntry>,
    };
  } catch {
    return { version: 1, repos: {} };
  }
}

export async function saveLockfile(repoRoot: string, lockfile: DocpupLockfile) {
  const lockfilePath = getLockfilePath(repoRoot);
  const sortedRepos = Object.fromEntries(
    Object.entries(lockfile.repos).sort(([left], [right]) => left.localeCompare(right))
  );
  const normalized: DocpupLockfile = {
    version: 1,
    repos: sortedRepos,
  };
  await fs.writeFile(lockfilePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export function buildProcessingHash(
  repo: RepoConfig,
  scanConfig: DocpupConfig["scan"]
) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        sourcePath: repo.sourcePath,
        sourcePaths: repo.sourcePaths,
        preprocess: repo.preprocess,
        scan: scanConfig,
        contentType: repo.contentType ?? "docs",
      })
    )
    .digest("hex");
}
