import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { updateGitignore } from "../src/gitignore.js";

describe("updateGitignore", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "docpup-gitignore-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should create .gitignore if it does not exist", async () => {
    await updateGitignore({
      repoRoot: tempDir,
      docsEntry: "docs/",
      sectionHeader: "Docpup generated docs",
    });

    const content = await readFile(path.join(tempDir, ".gitignore"), "utf-8");

    expect(content).toContain("# Docpup generated docs");
    expect(content).toContain("docs/");
  });

  it("should add section to existing .gitignore", async () => {
    await writeFile(path.join(tempDir, ".gitignore"), "node_modules/\n");

    await updateGitignore({
      repoRoot: tempDir,
      docsEntry: "docs/",
      sectionHeader: "Docpup generated docs",
    });

    const content = await readFile(path.join(tempDir, ".gitignore"), "utf-8");

    expect(content).toContain("node_modules/");
    expect(content).toContain("# Docpup generated docs");
    expect(content).toContain("docs/");
  });

  it("should not duplicate entries", async () => {
    await updateGitignore({
      repoRoot: tempDir,
      docsEntry: "docs/",
      sectionHeader: "Docpup generated docs",
    });

    await updateGitignore({
      repoRoot: tempDir,
      docsEntry: "docs/",
      sectionHeader: "Docpup generated docs",
    });

    const content = await readFile(path.join(tempDir, ".gitignore"), "utf-8");
    const matches = content.match(/docs\//g);

    expect(matches?.length).toBe(1);
  });

  it("should add new entries to existing section", async () => {
    await updateGitignore({
      repoRoot: tempDir,
      docsEntry: "docs/repo1/",
      sectionHeader: "Docpup generated docs",
    });

    await updateGitignore({
      repoRoot: tempDir,
      docsEntry: "docs/repo2/",
      sectionHeader: "Docpup generated docs",
    });

    const content = await readFile(path.join(tempDir, ".gitignore"), "utf-8");

    expect(content).toContain("docs/repo1/");
    expect(content).toContain("docs/repo2/");
  });

  it("should do nothing for empty entries", async () => {
    await writeFile(path.join(tempDir, ".gitignore"), "node_modules/\n");

    await updateGitignore({
      repoRoot: tempDir,
      sectionHeader: "Docpup generated docs",
    });

    const content = await readFile(path.join(tempDir, ".gitignore"), "utf-8");

    expect(content).toBe("node_modules/\n");
  });

  it("should add index entry when provided", async () => {
    await updateGitignore({
      repoRoot: tempDir,
      docsEntry: "docs/repo1/",
      indexEntry: "docs/indices/repo1-index.md",
      sectionHeader: "Docpup generated docs",
    });

    const content = await readFile(path.join(tempDir, ".gitignore"), "utf-8");

    expect(content).toContain("docs/repo1/");
    expect(content).toContain("docs/indices/repo1-index.md");
  });
});
