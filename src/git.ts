import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

export type SparseCheckoutArgs = {
  repoUrl: string;
  sourcePaths: string[];
  ref?: string;
  tempDir: string;
};

export type SparseCheckoutResult =
  | { ok: true; checkoutPaths: string[]; ref: string }
  | { ok: false; error: string };

const gitEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
};

async function runGit(args: string[], cwd: string) {
  await execa("git", args, {
    cwd,
    env: gitEnv,
    stdin: "ignore",
  });
}

async function runGitCapture(args: string[], cwd: string) {
  const result = await execa("git", args, {
    cwd,
    env: gitEnv,
    stdin: "ignore",
  });
  return result.stdout;
}

async function getDefaultBranch(cwd: string): Promise<string | null> {
  try {
    const output = await runGitCapture(
      ["ls-remote", "--symref", "origin", "HEAD"],
      cwd
    );
    const match = output.match(/ref: refs\/heads\/(\S+)\s+HEAD/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function ensureEmptyDir(dir: string) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

function normalizePath(p: string): string {
  let normalized = p.replace(/\\/g, "/").trim();
  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return normalized.replace(/^\/+/, "").replace(/\/+$/, "");
}

function isLikelyFile(p: string): boolean {
  return /\.[a-zA-Z0-9]+$/.test(p) && !p.endsWith("/");
}

function buildNoConePatterns(paths: string[]): string {
  const patterns = paths.flatMap((p) => {
    if (!p || p === ".") {
      return [];
    }
    if (isLikelyFile(p)) {
      return [`/${p}`];
    }
    return [`/${p.replace(/\/+$/, "")}/**`];
  });
  return patterns.join("\n");
}

export async function sparseCheckoutRepo(
  args: SparseCheckoutArgs
): Promise<SparseCheckoutResult> {
  const { repoUrl, sourcePaths, tempDir } = args;
  const requestedRef = args.ref?.trim();

  const normalizedPaths = sourcePaths.map(normalizePath);
  const hasRoot = normalizedPaths.some((p) => p === "" || p === ".");
  const hasFiles = normalizedPaths.some(isLikelyFile);

  try {
    await ensureEmptyDir(tempDir);
    await runGit(["init"], tempDir);
    await runGit(["remote", "add", "origin", repoUrl], tempDir);

    if (!hasRoot) {
      if (hasFiles) {
        // No-cone mode for file or mixed path selections
        await runGit(["sparse-checkout", "init", "--no-cone"], tempDir);
        const patterns = buildNoConePatterns(normalizedPaths);
        await fs.writeFile(
          path.join(tempDir, ".git/info/sparse-checkout"),
          patterns
        );
      } else {
        // Cone mode for directories only
        await runGit(["sparse-checkout", "init", "--cone"], tempDir);
        await runGit(["sparse-checkout", "set", ...normalizedPaths], tempDir);
      }
    }

    let refsToTry: string[] = [];
    if (requestedRef) {
      refsToTry = [requestedRef];
    } else {
      const defaultBranch = await getDefaultBranch(tempDir);
      if (defaultBranch) {
        refsToTry.push(defaultBranch);
      }
      refsToTry.push("main", "master");
      refsToTry = Array.from(new Set(refsToTry));
    }

    let lastError = "";
    for (const ref of refsToTry) {
      try {
        await runGit(["fetch", "--depth=1", "origin", ref], tempDir);
        await runGit(["checkout", "FETCH_HEAD"], tempDir);

        const checkoutPaths: string[] = [];
        for (const normalizedPath of normalizedPaths) {
          const isRoot = normalizedPath === "" || normalizedPath === ".";
          const checkoutPath = isRoot
            ? tempDir
            : path.resolve(tempDir, normalizedPath);
          try {
            await fs.access(checkoutPath);
            checkoutPaths.push(checkoutPath);
          } catch {
            // Path doesn't exist - continue checking others
          }
        }

        if (checkoutPaths.length === 0) {
          lastError = "No requested paths found in repository";
          continue;
        }

        return { ok: true, checkoutPaths, ref };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastError = message;
      }
    }

    return { ok: false, error: lastError || "Git sparse checkout failed." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}
