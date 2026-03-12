import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("../src/git.js", () => ({
  resolveGitRef: vi.fn(async (args: { ref?: string }) => ({
    ok: true as const,
    requestedRef: args.ref?.trim(),
    resolvedRef: args.ref?.trim() || "main",
    commitSha: "1111111111111111111111111111111111111111",
    isPinnedCommit: false,
  })),
  sparseCheckoutRepo: vi.fn(async (args: { tempDir: string }) => ({
    ok: true as const,
    checkoutPaths: [args.tempDir],
    ref: "main",
  })),
}));

vi.mock("../src/scanner.js", () => ({
  scanDocs: vi.fn(async () => new Map()),
  scanMultiplePaths: vi.fn(async () => new Map()),
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
import { resolveGitRef, sparseCheckoutRepo } from "../src/git.js";
import { resolveSitemapUrls } from "../src/sitemap.js";
import { scanDocs, scanMultiplePaths } from "../src/scanner.js";

const resolveGitRefMock = vi.mocked(resolveGitRef);
const sparseCheckoutRepoMock = vi.mocked(sparseCheckoutRepo);
const scanDocsMock = vi.mocked(scanDocs);
const scanMultiplePathsMock = vi.mocked(scanMultiplePaths);

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

describe("generateDocs git lockfile handling", () => {
  let tempDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docpup-cli-test-"));
    scanDocsMock.mockImplementation(async () => new Map([["", ["README.md"]]]));
    scanMultiplePathsMock.mockImplementation(async () => new Map([["", ["README.md"]]]));
    sparseCheckoutRepoMock.mockImplementation(async (args: { tempDir: string }) => {
      await fs.writeFile(path.join(args.tempDir, "README.md"), "# Hello\n", "utf8");
      return {
        ok: true as const,
        checkoutPaths: [args.tempDir],
        ref: "main",
      };
    });
    resolveGitRefMock.mockResolvedValue({
      ok: true,
      requestedRef: undefined,
      resolvedRef: "main",
      commitSha: "1111111111111111111111111111111111111111",
      isPinnedCommit: false,
    });
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("writes docpup-lock.json after a successful git run", async () => {
    const configPath = path.join(tempDir, "docpup.config.yaml");
    const config = `docsDir: documentation
indicesDir: documentation/indices
gitignore:
  addDocsDir: false
  addIndexFiles: false
repos:
  - name: axum
    repo: https://github.com/tokio-rs/axum
    sourcePath: .
`;

    await fs.writeFile(configPath, config, "utf8");

    const summary = await generateDocs({
      config: configPath,
      cwd: tempDir,
      concurrency: 1,
    });

    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(sparseCheckoutRepoMock).toHaveBeenCalledTimes(1);

    const lockfile = JSON.parse(
      await fs.readFile(path.join(tempDir, "docpup-lock.json"), "utf8")
    ) as {
      repos: Record<string, { commitSha: string; resolvedRef: string }>;
    };
    expect(lockfile.repos.axum?.commitSha).toBe(
      "1111111111111111111111111111111111111111"
    );
    expect(lockfile.repos.axum?.resolvedRef).toBe("main");
  });

  it("skips unchanged git repos when lockfile and outputs match", async () => {
    const configPath = path.join(tempDir, "docpup.config.yaml");
    const config = `docsDir: documentation
indicesDir: documentation/indices
gitignore:
  addDocsDir: false
  addIndexFiles: false
repos:
  - name: axum
    repo: https://github.com/tokio-rs/axum
    sourcePath: .
`;

    await fs.writeFile(configPath, config, "utf8");

    await generateDocs({
      config: configPath,
      cwd: tempDir,
      concurrency: 1,
    });
    sparseCheckoutRepoMock.mockClear();

    const summary = await generateDocs({
      config: configPath,
      cwd: tempDir,
      concurrency: 1,
    });

    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(sparseCheckoutRepoMock).not.toHaveBeenCalled();
  });

  it("rebuilds when refresh is requested even if the lockfile matches", async () => {
    const configPath = path.join(tempDir, "docpup.config.yaml");
    const config = `docsDir: documentation
indicesDir: documentation/indices
gitignore:
  addDocsDir: false
  addIndexFiles: false
repos:
  - name: axum
    repo: https://github.com/tokio-rs/axum
    sourcePath: .
`;

    await fs.writeFile(configPath, config, "utf8");

    await generateDocs({
      config: configPath,
      cwd: tempDir,
      concurrency: 1,
    });
    sparseCheckoutRepoMock.mockClear();

    const summary = await generateDocs({
      config: configPath,
      cwd: tempDir,
      concurrency: 1,
      refresh: true,
    });

    expect(summary.skipped).toBe(0);
    expect(sparseCheckoutRepoMock).toHaveBeenCalledTimes(1);
  });

  it("rebuilds when outputs are missing even if the lockfile matches", async () => {
    const configPath = path.join(tempDir, "docpup.config.yaml");
    const config = `docsDir: documentation
indicesDir: documentation/indices
gitignore:
  addDocsDir: false
  addIndexFiles: false
repos:
  - name: axum
    repo: https://github.com/tokio-rs/axum
    sourcePath: .
`;

    await fs.writeFile(configPath, config, "utf8");

    await generateDocs({
      config: configPath,
      cwd: tempDir,
      concurrency: 1,
    });

    await fs.rm(path.join(tempDir, "documentation", "axum"), {
      recursive: true,
      force: true,
    });
    sparseCheckoutRepoMock.mockClear();

    const summary = await generateDocs({
      config: configPath,
      cwd: tempDir,
      concurrency: 1,
    });

    expect(summary.skipped).toBe(0);
    expect(sparseCheckoutRepoMock).toHaveBeenCalledTimes(1);
  });
});

describe("generateDocs preprocess handling", () => {
  let tempDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docpup-cli-test-"));
    scanDocsMock.mockImplementation(async () => new Map());
    scanMultiplePathsMock.mockImplementation(async () => new Map());
  });

  afterEach(async () => {
    warnSpy.mockRestore();
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
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docpup-cli-test-"));
    scanDocsMock.mockImplementation(async () => new Map());
    scanMultiplePathsMock.mockImplementation(async () => new Map());
  });

  afterEach(async () => {
    warnSpy.mockRestore();
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
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docpup-cli-test-"));
    scanDocsMock.mockImplementation(async () => new Map());
    scanMultiplePathsMock.mockImplementation(async () => new Map());
  });

  afterEach(async () => {
    warnSpy.mockRestore();
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
