import { execa, type Options as ExecaOptions } from "execa";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SparseCheckoutResult } from "./types.js";

const gitEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
};

async function git(
  args: string[],
  options: ExecaOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const result = await execa("git", args, {
    env: gitEnv,
    ...options,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function tryCheckoutRef(
  cwd: string,
  ref: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await git(["fetch", "--depth=1", "origin", ref], { cwd });
    await git(["checkout", "FETCH_HEAD"], { cwd });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

async function getDefaultBranch(
  cwd: string
): Promise<string | null> {
  try {
    const result = await git(
      ["ls-remote", "--symref", "origin", "HEAD"],
      { cwd }
    );
    const match = result.stdout.match(/ref: refs\/heads\/(\S+)\s+HEAD/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export async function sparseCheckoutRepo(args: {
  repoUrl: string;
  sourcePath: string;
  ref?: string;
}): Promise<SparseCheckoutResult> {
  const { repoUrl, sourcePath, ref } = args;
  let tempDir: string | undefined;
  const isRootCheckout = sourcePath === "." || sourcePath === "/";

  try {
    tempDir = await mkdtemp(path.join(tmpdir(), "docpup-"));

    await git(["init"], { cwd: tempDir });
    await git(["remote", "add", "origin", repoUrl], { cwd: tempDir });

    if (!isRootCheckout) {
      await git(["sparse-checkout", "init", "--cone"], { cwd: tempDir });
      await git(["sparse-checkout", "set", sourcePath], { cwd: tempDir });
    }

    let refsToTry: string[];
    if (ref) {
      refsToTry = [ref];
    } else {
      const defaultBranch = await getDefaultBranch(tempDir);
      refsToTry = defaultBranch ? [defaultBranch] : ["main", "master"];
    }

    let lastError = "";
    for (const tryRef of refsToTry) {
      const result = await tryCheckoutRef(tempDir, tryRef);
      if (result.success) {
        const docsPath = isRootCheckout ? tempDir : path.join(tempDir, sourcePath);
        return { success: true, path: docsPath };
      }
      lastError = result.error || `Failed to checkout ${tryRef}`;
    }

    throw new Error(lastError);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }

    return { success: false, error: message };
  }
}

export async function cleanupTempDir(tempPath: string): Promise<void> {
  const tempRoot = tmpdir();
  const resolved = path.resolve(tempPath);

  if (!resolved.startsWith(tempRoot)) {
    return;
  }

  const parts = resolved.slice(tempRoot.length).split(path.sep).filter(Boolean);
  if (parts.length === 0) {
    return;
  }

  const topLevelDir = path.join(tempRoot, parts[0]);

  if (topLevelDir.includes("docpup-")) {
    await rm(topLevelDir, { recursive: true, force: true });
  }
}
