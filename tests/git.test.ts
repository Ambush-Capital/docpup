import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";
import { resolveGitRef } from "../src/git.js";

async function git(args: string[], cwd?: string) {
  await execa("git", args, { cwd, stdin: "ignore" });
}

async function gitCapture(args: string[], cwd?: string) {
  const result = await execa("git", args, { cwd, stdin: "ignore" });
  return result.stdout.trim();
}

async function createRemoteRepo() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "docpup-git-test-"));
  const remoteDir = path.join(rootDir, "remote.git");
  const workDir = path.join(rootDir, "work");

  await git(["init", "--bare", remoteDir]);
  await git(["symbolic-ref", "HEAD", "refs/heads/main"], remoteDir);
  await git(["init", "-b", "main", workDir]);
  await git(["config", "user.name", "Docpup Test"], workDir);
  await git(["config", "user.email", "docpup@example.com"], workDir);
  await fs.writeFile(path.join(workDir, "README.md"), "# Hello\n", "utf8");
  await git(["add", "README.md"], workDir);
  await git(["commit", "-m", "initial"], workDir);
  await git(["remote", "add", "origin", remoteDir], workDir);
  await git(["push", "-u", "origin", "main"], workDir);

  return { rootDir, remoteDir, workDir };
}

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupDirs.splice(0, cleanupDirs.length).map((dir) =>
      fs.rm(dir, { recursive: true, force: true })
    )
  );
});

describe("resolveGitRef", () => {
  it("resolves the remote default branch and HEAD sha", async () => {
    const repo = await createRemoteRepo();
    cleanupDirs.push(repo.rootDir);

    const resolved = await resolveGitRef({ repoUrl: repo.remoteDir });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const headSha = await gitCapture(["rev-parse", "HEAD"], repo.workDir);
    expect(resolved.resolvedRef).toBe("main");
    expect(resolved.commitSha).toBe(headSha);
  });

  it("resolves an explicit branch ref", async () => {
    const repo = await createRemoteRepo();
    cleanupDirs.push(repo.rootDir);

    await git(["checkout", "-b", "release"], repo.workDir);
    await fs.writeFile(path.join(repo.workDir, "CHANGELOG.md"), "release\n", "utf8");
    await git(["add", "CHANGELOG.md"], repo.workDir);
    await git(["commit", "-m", "release"], repo.workDir);
    await git(["push", "-u", "origin", "release"], repo.workDir);

    const resolved = await resolveGitRef({
      repoUrl: repo.remoteDir,
      ref: "release",
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const releaseSha = await gitCapture(["rev-parse", "HEAD"], repo.workDir);
    expect(resolved.resolvedRef).toBe("release");
    expect(resolved.commitSha).toBe(releaseSha);
  });

  it("accepts a pinned commit sha without contacting the remote", async () => {
    const sha = "1234567890abcdef1234567890abcdef12345678";
    const resolved = await resolveGitRef({
      repoUrl: "/path/that/does/not/exist",
      ref: sha,
    });

    expect(resolved).toEqual({
      ok: true,
      requestedRef: sha,
      resolvedRef: sha,
      commitSha: sha,
      isPinnedCommit: true,
    });
  });
});
