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
      expect(content).toContain("documentation/");
      expect(content).toContain("documentation/indices/");
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

  it(
    "should index a single file from a repo",
    async () => {
      const projectDir = path.join(testDir, "single-file-test");
      await mkdir(projectDir, { recursive: true });

      const config = `
docsDir: documentation
indicesDir: documentation/indices
repos:
  - name: codex-readme
    repo: https://github.com/openai/codex
    sourcePaths:
      - sdk/typescript/README.md
`;
      await writeFile(path.join(projectDir, "docpup.config.yaml"), config);

      const result = await runDocpup(projectDir);

      expect(result.exitCode).toBe(0);

      const indexPath = path.join(
        projectDir,
        "documentation/indices/codex-readme-index.md"
      );
      expect(await fileExists(indexPath)).toBe(true);

      const indexContent = await readFile(indexPath, "utf-8");
      expect(indexContent).toContain("<!-- CODEX-README-AGENTS-MD-START -->");
      expect(indexContent).toContain("README.md");

      // Check that only the single file was copied
      const readmePath = path.join(
        projectDir,
        "documentation/codex-readme/sdk/typescript/README.md"
      );
      expect(await fileExists(readmePath)).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "should index multiple directories with source content type",
    async () => {
      const projectDir = path.join(testDir, "multi-dir-source-test");
      await mkdir(projectDir, { recursive: true });

      const config = `
docsDir: documentation
indicesDir: documentation/indices
repos:
  - name: codex-sdk
    repo: https://github.com/openai/codex
    contentType: source
    sourcePaths:
      - sdk/typescript/src
      - sdk/typescript/samples
    scan:
      extensions: [".ts", ".tsx"]
`;
      await writeFile(path.join(projectDir, "docpup.config.yaml"), config);

      const result = await runDocpup(projectDir);

      expect(result.exitCode).toBe(0);

      const indexPath = path.join(
        projectDir,
        "documentation/indices/codex-sdk-index.md"
      );
      expect(await fileExists(indexPath)).toBe(true);

      const indexContent = await readFile(indexPath, "utf-8");
      // Should have Source Index title, not Docs Index
      expect(indexContent).toContain("[codex-sdk Source Index]");
      // Should have source-specific warning
      expect(indexContent).toContain("This is source code from codex-sdk");
      // Should NOT have the docs warning
      expect(indexContent).not.toContain("What you remember about");

      // Check that src directory was copied
      const srcDir = path.join(
        projectDir,
        "documentation/codex-sdk/sdk/typescript/src"
      );
      expect(await fileExists(srcDir)).toBe(true);

      // Check that samples directory was copied
      const samplesDir = path.join(
        projectDir,
        "documentation/codex-sdk/sdk/typescript/samples"
      );
      expect(await fileExists(samplesDir)).toBe(true);
    },
    TEST_TIMEOUT
  );

  async function countFilesWithExtension(
    dir: string,
    extensions: string[]
  ): Promise<number> {
    let count = 0;
    const extSet = new Set(extensions.map((e) => e.toLowerCase()));
    async function walk(d: string): Promise<void> {
      const entries = await readdir(d, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await walk(path.join(d, entry.name));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extSet.has(ext)) {
            count += 1;
          }
        }
      }
    }
    if (await fileExists(dir)) {
      await walk(dir);
    }
    return count;
  }

  it(
    "should index mixed file and directory paths",
    async () => {
      const projectDir = path.join(testDir, "mixed-paths-test");
      await mkdir(projectDir, { recursive: true });

      const config = `
docsDir: documentation
indicesDir: documentation/indices
repos:
  - name: codex-mixed
    repo: https://github.com/openai/codex
    contentType: source
    sourcePaths:
      - sdk/typescript/src
      - sdk/typescript/README.md
    scan:
      extensions: [".ts", ".md"]
`;
      await writeFile(path.join(projectDir, "docpup.config.yaml"), config);

      const result = await runDocpup(projectDir);

      expect(result.exitCode).toBe(0);

      const indexPath = path.join(
        projectDir,
        "documentation/indices/codex-mixed-index.md"
      );
      expect(await fileExists(indexPath)).toBe(true);

      const indexContent = await readFile(indexPath, "utf-8");
      expect(indexContent).toContain("README.md");

      const readmePath = path.join(
        projectDir,
        "documentation/codex-mixed/sdk/typescript/README.md"
      );
      expect(await fileExists(readmePath)).toBe(true);

      const srcDir = path.join(
        projectDir,
        "documentation/codex-mixed/sdk/typescript/src"
      );
      const tsCount = await countFilesWithExtension(srcDir, [".ts"]);
      expect(tsCount).toBeGreaterThan(0);
    },
    TEST_TIMEOUT
  );

  it(
    "should filter by custom extensions",
    async () => {
      const projectDir = path.join(testDir, "custom-ext-test");
      await mkdir(projectDir, { recursive: true });

      const config = `
docsDir: documentation
indicesDir: documentation/indices
repos:
  - name: codex-ts-only
    repo: https://github.com/openai/codex
    contentType: source
    sourcePaths:
      - sdk/typescript/src
    scan:
      extensions: [".ts"]
`;
      await writeFile(path.join(projectDir, "docpup.config.yaml"), config);

      const result = await runDocpup(projectDir);

      expect(result.exitCode).toBe(0);

      const docsDir = path.join(projectDir, "documentation/codex-ts-only");
      const tsCount = await countFilesWithExtension(docsDir, [".ts"]);
      const jsCount = await countFilesWithExtension(docsDir, [".js"]);
      const mdCount = await countFilesWithExtension(docsDir, [".md"]);

      // Should have at least one .ts file
      expect(tsCount).toBeGreaterThan(0);
      // Should not have any .js or .md files since we only specified .ts
      expect(jsCount).toBe(0);
      expect(mdCount).toBe(0);
    },
    TEST_TIMEOUT
  );
});
