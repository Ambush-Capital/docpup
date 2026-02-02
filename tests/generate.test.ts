import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect } from "vitest";
import { generateDocs } from "../src/cli.js";

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

test(
  "generate docs for known repos",
  async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docpup-test-"));
    const configPath = path.join(tempDir, "docpup.config.yaml");

    const config = `docsDir: documentation
indicesDir: documentation/indices
gitignore:
  addDocsDir: true
  addIndexFiles: true
  sectionHeader: "Docpup generated docs"
scan:
  includeMd: true
  includeMdx: true
  excludeDirs:
    - .git
    - node_modules
    - images
    - img
    - media
    - assets
    - css
    - fonts
repos:
  - name: nextjs
    repo: https://github.com/vercel/next.js
    sourcePath: docs
    ref: canary
  - name: auth0-docs
    repo: https://github.com/auth0/docs-v2
    sourcePath: main/docs
  - name: axum
    repo: https://github.com/tokio-rs/axum
    sourcePath: .
  - name: temporal
    repo: https://github.com/temporalio/documentation
    sourcePath: docs
`;

    try {
      await fs.writeFile(configPath, config, "utf8");

      const summary = await generateDocs({
        config: configPath,
        cwd: tempDir,
        concurrency: 2,
      });

      expect(summary.failed).toBe(0);
      expect(summary.succeeded).toBe(4);

      const docsRoot = path.join(tempDir, "documentation");
      const indicesRoot = path.join(tempDir, "documentation/indices");

      const repos = ["nextjs", "auth0-docs", "axum", "temporal"];
      for (const repo of repos) {
        const repoDir = path.join(docsRoot, repo);
        const repoFiles = await listFiles(repoDir);

        expect(repoFiles.length).toBeGreaterThan(0);
        for (const file of repoFiles) {
          expect([".md", ".mdx"]).toContain(path.extname(file));
        }

        const indexPath = path.join(indicesRoot, `${repo}-index.md`);
        const indexContent = await fs.readFile(indexPath, "utf8");
        expect(indexContent.length).toBeGreaterThan(20);
        expect(indexContent).toContain("AGENTS-MD-START");
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  },
  900000
);
