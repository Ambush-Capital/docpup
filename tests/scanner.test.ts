import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanDocs } from "../src/scanner.js";
import type { DocpupConfig } from "../src/types.js";

describe("scanDocs", () => {
  let tempDir: string;

  const defaultScanConfig: DocpupConfig["scan"] = {
    includeMd: true,
    includeMdx: true,
    includeHiddenDirs: false,
    excludeDirs: ["node_modules", "images"],
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "docpup-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should find markdown files in root", async () => {
    await writeFile(path.join(tempDir, "README.md"), "# Hello");
    await writeFile(path.join(tempDir, "guide.md"), "# Guide");

    const tree = await scanDocs(tempDir, defaultScanConfig);

    expect(tree.has("")).toBe(true);
    expect(tree.get("")?.sort()).toEqual(["README.md", "guide.md"]);
  });

  it("should find markdown files in subdirectories", async () => {
    await mkdir(path.join(tempDir, "docs"));
    await writeFile(path.join(tempDir, "docs", "intro.md"), "# Intro");
    await writeFile(path.join(tempDir, "docs", "setup.mdx"), "# Setup");

    const tree = await scanDocs(tempDir, defaultScanConfig);

    expect(tree.has("docs")).toBe(true);
    expect(tree.get("docs")?.sort()).toEqual(["intro.md", "setup.mdx"]);
  });

  it("should exclude configured directories", async () => {
    await mkdir(path.join(tempDir, "node_modules"));
    await writeFile(path.join(tempDir, "node_modules", "pkg.md"), "# Pkg");
    await writeFile(path.join(tempDir, "README.md"), "# Hello");

    const tree = await scanDocs(tempDir, defaultScanConfig);

    expect(tree.has("node_modules")).toBe(false);
    expect(tree.has("")).toBe(true);
  });

  it("should respect includeMd flag", async () => {
    await writeFile(path.join(tempDir, "doc.md"), "# Doc");
    await writeFile(path.join(tempDir, "doc.mdx"), "# Doc");

    const tree = await scanDocs(tempDir, {
      ...defaultScanConfig,
      includeMd: false,
    });

    expect(tree.get("")).toEqual(["doc.mdx"]);
  });

  it("should respect includeMdx flag", async () => {
    await writeFile(path.join(tempDir, "doc.md"), "# Doc");
    await writeFile(path.join(tempDir, "doc.mdx"), "# Doc");

    const tree = await scanDocs(tempDir, {
      ...defaultScanConfig,
      includeMdx: false,
    });

    expect(tree.get("")).toEqual(["doc.md"]);
  });

  it("should return empty map for empty directory", async () => {
    const tree = await scanDocs(tempDir, defaultScanConfig);
    expect(tree.size).toBe(0);
  });

  it("should skip hidden directories by default", async () => {
    await mkdir(path.join(tempDir, ".hidden"));
    await writeFile(path.join(tempDir, ".hidden", "secret.md"), "# Secret");
    await writeFile(path.join(tempDir, "README.md"), "# Hello");

    const tree = await scanDocs(tempDir, defaultScanConfig);

    expect(tree.has(".hidden")).toBe(false);
    expect(tree.has("")).toBe(true);
  });

  it("should include hidden directories when enabled", async () => {
    await mkdir(path.join(tempDir, ".hidden"));
    await writeFile(path.join(tempDir, ".hidden", "secret.md"), "# Secret");

    const tree = await scanDocs(tempDir, {
      ...defaultScanConfig,
      includeHiddenDirs: true,
    });

    expect(tree.has(".hidden")).toBe(true);
  });
});
