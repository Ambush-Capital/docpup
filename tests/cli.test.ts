import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("../src/git.js", () => ({
  sparseCheckoutRepo: vi.fn(async (args: { tempDir: string }) => ({
    ok: true as const,
    checkoutPaths: [args.tempDir],
    ref: "main",
  })),
}));

vi.mock("../src/scanner.js", () => ({
  scanDocs: vi.fn(async () => new Map()),
}));

vi.mock("../src/preprocess.js", () => ({
  runPreprocess: vi.fn(async (tempDir: string) => tempDir),
}));

vi.mock("../src/url-fetcher.js", () => ({
  fetchUrlSource: vi.fn(async () => {}),
}));

vi.mock("../src/sitemap.js", () => ({
  resolveSitemapUrls: vi.fn(async () => [
    "https://example.com/docs/overview",
    "https://example.com/docs/guide",
  ]),
}));

import { generateDocs, mergeScanConfig } from "../src/cli.js";
import { fetchUrlSource } from "../src/url-fetcher.js";
import { sparseCheckoutRepo } from "../src/git.js";
import { resolveSitemapUrls } from "../src/sitemap.js";

describe("mergeScanConfig", () => {
  it("merges excludeDirs and overrides flags", () => {
    const base = {
      includeMd: true,
      includeMdx: true,
      includeHiddenDirs: false,
      excludeDirs: ["node_modules", "images"],
    };
    const overrides = {
      includeHiddenDirs: true,
      excludeDirs: ["images", "_build"],
    };

    const merged = mergeScanConfig(base, overrides);

    expect(merged.includeHiddenDirs).toBe(true);
    expect(merged.excludeDirs).toEqual(["node_modules", "images", "_build"]);
  });
});

describe("generateDocs preprocess handling", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docpup-cli-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("fails when preprocess output has no markdown files", async () => {
    const configPath = path.join(tempDir, "docpup.config.yaml");
    const config = `docsDir: documentation
indicesDir: documentation/indices
gitignore:
  addDocsDir: false
  addIndexFiles: false
repos:
  - name: django-docs
    repo: https://github.com/django/django
    sourcePath: .
    preprocess:
      type: sphinx
      workDir: .
      builder: markdown
      outputDir: docpup-build
`;

    await fs.writeFile(configPath, config, "utf8");

    const summary = await generateDocs({
      config: configPath,
      cwd: tempDir,
      concurrency: 1,
    });

    expect(summary.failed).toBe(1);
    expect(summary.failures[0]?.error).toContain(
      "produced no markdown files"
    );
  });
});

describe("generateDocs URL source handling", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docpup-cli-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("calls fetchUrlSource instead of sparseCheckoutRepo for URL sources", async () => {
    const configPath = path.join(tempDir, "docpup.config.yaml");
    const config = `docsDir: documentation
indicesDir: documentation/indices
gitignore:
  addDocsDir: false
  addIndexFiles: false
repos:
  - name: claude-docs
    urls:
      - https://example.com/overview
      - https://example.com/guide
`;

    await fs.writeFile(configPath, config, "utf8");

    const summary = await generateDocs({
      config: configPath,
      cwd: tempDir,
      concurrency: 1,
    });

    expect(fetchUrlSource).toHaveBeenCalledTimes(1);
    expect(sparseCheckoutRepo).not.toHaveBeenCalled();
    // scanDocs returns empty map, so this should fail with "no files"
    expect(summary.failed).toBe(1);
    expect(summary.failures[0]?.error).toContain("URL fetch produced no files");
  });
});

describe("generateDocs sitemap source handling", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docpup-cli-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("calls resolveSitemapUrls and fetchUrlSource for sitemap sources", async () => {
    const configPath = path.join(tempDir, "docpup.config.yaml");
    const config = `docsDir: documentation
indicesDir: documentation/indices
gitignore:
  addDocsDir: false
  addIndexFiles: false
repos:
  - name: api-docs
    sitemap: https://example.com/sitemap.xml
    paths:
      - prefix: docs/en/api
        subs:
          - sdks
`;

    await fs.writeFile(configPath, config, "utf8");

    const summary = await generateDocs({
      config: configPath,
      cwd: tempDir,
      concurrency: 1,
    });

    expect(resolveSitemapUrls).toHaveBeenCalledTimes(1);
    expect(resolveSitemapUrls).toHaveBeenCalledWith({
      sitemapUrl: "https://example.com/sitemap.xml",
      paths: [{ prefix: "docs/en/api", subs: ["sdks"] }],
    });
    expect(fetchUrlSource).toHaveBeenCalledTimes(1);
    expect(sparseCheckoutRepo).not.toHaveBeenCalled();
    // scanDocs returns empty map, so this should fail with "no files"
    expect(summary.failed).toBe(1);
    expect(summary.failures[0]?.error).toContain("URL fetch produced no files");
  });
});
