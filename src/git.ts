import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

export type SparseCheckoutArgs = {
  repoUrl: string;
  sourcePath: string;
  ref?: string;
  tempDir: string;
};

export type SparseCheckoutResult =
  | { ok: true; checkoutPath: string; ref: string }
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

export async function sparseCheckoutRepo(
  args: SparseCheckoutArgs
): Promise<SparseCheckoutResult> {
  const { repoUrl, sourcePath, tempDir } = args;
  const requestedRef = args.ref?.trim();

  let normalizedPath = sourcePath.replace(/\\/g, "/").trim();
  if (normalizedPath.startsWith("./")) {
    normalizedPath = normalizedPath.slice(2);
  }
  normalizedPath = normalizedPath.replace(/^\/+/, "").replace(/\/+$/, "");
  const isRoot = normalizedPath === "" || normalizedPath === ".";

  try {
    await ensureEmptyDir(tempDir);
    await runGit(["init"], tempDir);
    await runGit(["remote", "add", "origin", repoUrl], tempDir);

    if (!isRoot) {
      await runGit(["sparse-checkout", "init", "--cone"], tempDir);
      await runGit(["sparse-checkout", "set", normalizedPath], tempDir);
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

        const checkoutPath = isRoot
          ? tempDir
          : path.resolve(tempDir, normalizedPath);
        await fs.access(checkoutPath);
        return { ok: true, checkoutPath, ref };
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
