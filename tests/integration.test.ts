import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execa } from "execa";
import { writeFile, mkdir } from "node:fs/promises";

const TEST_TIMEOUT = 900000;

describe("integration", () => {
  let testDir: string;
  const cliPath = path.resolve(process.cwd(), "dist/cli.js");

  beforeAll(async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "docpup-integration-"));
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  async function runDocpup(
    configDir: string,
    args: string[] = []
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const result = await execa("node", [cliPath, "generate", ...args], {
        cwd: configDir,
        env: { ...process.env, FORCE_COLOR: "0" },
      });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; exitCode?: number };
      return {
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? "",
        exitCode: e.exitCode ?? 1,
      };
    }
  }

  async function fileExists(p: string): Promise<boolean> {
    try {
      await stat(p);
      return true;
    } catch {
      return false;
    }
  }

  async function countMdFiles(dir: string): Promise<number> {
    let count = 0;
    async function walk(d: string): Promise<void> {
      const entries = await readdir(d, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await walk(path.join(d, entry.name));
        } else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) {
          count += 1;
        }
      }
    }
    if (await fileExists(dir)) {
      await walk(dir);
    }
    return count;
  }

  it(
    "should index Next.js docs",
    async () => {
      const projectDir = path.join(testDir, "nextjs-test");
      await mkdir(projectDir, { recursive: true });

      const config = `
docsDir: documentation
indicesDir: documentation/indices
repos:
  - name: nextjs
    repo: https://github.com/vercel/next.js
    sourcePath: docs
`;
      await writeFile(path.join(projectDir, "docpup.config.yaml"), config);

      const result = await runDocpup(projectDir);

      expect(result.exitCode).toBe(0);

      const docsDir = path.join(projectDir, "documentation/nextjs");
      const fileCount = await countMdFiles(docsDir);

      expect(fileCount).toBeGreaterThan(10);

      const indexPath = path.join(
        projectDir,
        "documentation/indices/nextjs-index.md"
      );
      expect(await fileExists(indexPath)).toBe(true);

      const indexContent = await readFile(indexPath, "utf-8");
      expect(indexContent).toContain("<!-- NEXTJS-AGENTS-MD-START -->");
    },
    TEST_TIMEOUT
  );

  it(
    "should index Axum repo",
    async () => {
      const projectDir = path.join(testDir, "axum-test");
      await mkdir(projectDir, { recursive: true });

      const config = `
docsDir: documentation
indicesDir: documentation/indices
repos:
  - name: axum
    repo: https://github.com/tokio-rs/axum
    sourcePath: .
`;
      await writeFile(path.join(projectDir, "docpup.config.yaml"), config);

      const result = await runDocpup(projectDir);

      expect(result.exitCode).toBe(0);

      const indexPath = path.join(
        projectDir,
        "documentation/indices/axum-index.md"
      );
      expect(await fileExists(indexPath)).toBe(true);

      const indexContent = await readFile(indexPath, "utf-8");
      expect(indexContent).toContain("<!-- AXUM-AGENTS-MD-START -->");
      expect(indexContent).toContain("README.md");
    },
    TEST_TIMEOUT
  );

  it(
    "should index Temporal docs",
    async () => {
      const projectDir = path.join(testDir, "temporal-test");
      await mkdir(projectDir, { recursive: true });

      const config = `
docsDir: documentation
indicesDir: documentation/indices
repos:
  - name: temporal
    repo: https://github.com/temporalio/documentation
    sourcePath: docs
`;
      await writeFile(path.join(projectDir, "docpup.config.yaml"), config);

      const result = await runDocpup(projectDir);

      expect(result.exitCode).toBe(0);

      const indexPath = path.join(
        projectDir,
        "documentation/indices/temporal-index.md"
      );
      expect(await fileExists(indexPath)).toBe(true);

      const docsDir = path.join(projectDir, "documentation/temporal");
      const fileCount = await countMdFiles(docsDir);
      expect(fileCount).toBeGreaterThan(5);
    },
    TEST_TIMEOUT
  );

  it(
    "should index Auth0 docs",
    async () => {
      const projectDir = path.join(testDir, "auth0-test");
      await mkdir(projectDir, { recursive: true });

      const config = `
docsDir: documentation
indicesDir: documentation/indices
repos:
  - name: auth0
    repo: https://github.com/auth0/docs-v2
    sourcePath: main/docs
`;
      await writeFile(path.join(projectDir, "docpup.config.yaml"), config);

      const result = await runDocpup(projectDir);

      expect(result.exitCode).toBe(0);

      const indexPath = path.join(
        projectDir,
        "documentation/indices/auth0-index.md"
      );
      expect(await fileExists(indexPath)).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "should handle --only filter",
    async () => {
      const projectDir = path.join(testDir, "filter-test");
      await mkdir(projectDir, { recursive: true });

      const config = `
docsDir: documentation
indicesDir: documentation/indices
repos:
  - name: repo-a
    repo: https://github.com/tokio-rs/axum
    sourcePath: .
  - name: repo-b
    repo: https://github.com/tokio-rs/axum
    sourcePath: .
  - name: repo-c
    repo: https://github.com/tokio-rs/axum
    sourcePath: .
`;
      await writeFile(path.join(projectDir, "docpup.config.yaml"), config);

      const result = await runDocpup(projectDir, [
        "--only",
        "repo-a,repo-b",
      ]);

      expect(result.exitCode).toBe(0);

      const indexA = path.join(
        projectDir,
        "documentation/indices/repo-a-index.md"
      );
      const indexB = path.join(
        projectDir,
        "documentation/indices/repo-b-index.md"
      );
      const indexC = path.join(
        projectDir,
        "documentation/indices/repo-c-index.md"
      );

      expect(await fileExists(indexA)).toBe(true);
      expect(await fileExists(indexB)).toBe(true);
      expect(await fileExists(indexC)).toBe(false);
    },
    TEST_TIMEOUT
  );

  it(
    "should update .gitignore",
    async () => {
      const projectDir = path.join(testDir, "gitignore-test");
      await mkdir(projectDir, { recursive: true });

      const config = `
docsDir: documentation
indicesDir: documentation/indices
gitignore:
  addDocsDir: true
  addIndexFiles: true
repos:
  - name: axum
    repo: https://github.com/tokio-rs/axum
    sourcePath: .
`;
      await writeFile(path.join(projectDir, "docpup.config.yaml"), config);

      await runDocpup(projectDir);

      const gitignorePath = path.join(projectDir, ".gitignore");
      expect(await fileExists(gitignorePath)).toBe(true);

      const content = await readFile(gitignorePath, "utf-8");
      expect(content).toContain("documentation/axum/");
      expect(content).toContain("documentation/indices/axum-index.md");
    },
    TEST_TIMEOUT
  );

  it(
    "should handle repo with minimal markdown",
    async () => {
      const projectDir = path.join(testDir, "hello-world-test");
      await mkdir(projectDir, { recursive: true });

      const config = `
docsDir: documentation
indicesDir: documentation/indices
repos:
  - name: hello-world
    repo: https://github.com/octocat/Hello-World
    sourcePath: .
`;
      await writeFile(path.join(projectDir, "docpup.config.yaml"), config);

      const result = await runDocpup(projectDir);

      expect(result.exitCode).toBe(0);

      const indexPath = path.join(
        projectDir,
        "documentation/indices/hello-world-index.md"
      );
      expect(await fileExists(indexPath)).toBe(true);

      const indexContent = await readFile(indexPath, "utf-8");
      expect(indexContent).toContain("<!-- HELLO-WORLD-AGENTS-MD-START -->");
    },
    TEST_TIMEOUT
  );
});
