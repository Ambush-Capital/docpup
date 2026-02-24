import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { runPreprocess } from "../src/preprocess.js";
import type { RepoConfig } from "../src/types.js";

vi.mock("execa", () => ({
  execa: vi.fn(async () => ({ stdout: "", stderr: "" })),
}));

const execaMock = vi.mocked(execa);

describe("runPreprocess html", () => {
  let tempDir: string;

  beforeEach(async () => {
    execaMock.mockReset();
    execaMock.mockResolvedValue({ stdout: "", stderr: "" } as never);
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docpup-preprocess-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("converts html and rewrites links", async () => {
    const docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(
      path.join(docsDir, "index.html"),
      `<!doctype html><html><body><main><h1>Intro</h1><p><a href="guide.html#x">Guide</a></p></main></body></html>`,
      "utf8"
    );

    const repo: RepoConfig = {
      name: "sample",
      repo: "https://example.com/repo",
      sourcePath: "docs",
      preprocess: {
        type: "html",
        workDir: "docs",
        outputDir: "docpup-build",
        rewriteLinks: true,
      },
    };

    const outputDir = await runPreprocess(tempDir, repo);
    const outputFile = path.join(outputDir, "index.md");
    const content = await fs.readFile(outputFile, "utf8");

    expect(content).toContain("# Intro");
    expect(content).toContain("guide.md#x");
  });

  it("respects selector override", async () => {
    const docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(
      path.join(docsDir, "index.html"),
      `<!doctype html><html><body><main><h1>Main</h1></main><article><h1>Article</h1></article></body></html>`,
      "utf8"
    );

    const repo: RepoConfig = {
      name: "sample",
      repo: "https://example.com/repo",
      sourcePath: "docs",
      preprocess: {
        type: "html",
        workDir: "docs",
        outputDir: "docpup-build",
        selector: "article",
      },
    };

    const outputDir = await runPreprocess(tempDir, repo);
    const outputFile = path.join(outputDir, "index.md");
    const content = await fs.readFile(outputFile, "utf8");

    expect(content).toContain("# Article");
    expect(content).not.toContain("# Main");
  });

  it("fails when no html files exist", async () => {
    const docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    const repo: RepoConfig = {
      name: "sample",
      repo: "https://example.com/repo",
      sourcePath: "docs",
      preprocess: {
        type: "html",
        workDir: "docs",
        outputDir: "docpup-build",
      },
    };

    await expect(runPreprocess(tempDir, repo)).rejects.toThrow(
      "produced no markdown files"
    );
  });
});

describe("runPreprocess sphinx", () => {
  let tempDir: string;

  beforeEach(async () => {
    execaMock.mockReset();
    execaMock.mockResolvedValue({ stdout: "", stderr: "" } as never);
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docpup-preprocess-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("runs sphinx with markdown builder", async () => {
    const docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    const repo: RepoConfig = {
      name: "django-docs",
      repo: "https://example.com/repo",
      sourcePath: "docs",
      preprocess: {
        type: "sphinx",
      },
    };

    const outputDir = await runPreprocess(tempDir, repo);

    expect(outputDir).toBe(path.join(tempDir, "docpup-build"));
    expect(execaMock).toHaveBeenCalledWith(
      "python",
      ["-m", "sphinx", "-b", "markdown", "docs", "docpup-build"],
      {
        cwd: tempDir,
        stdin: "ignore",
      }
    );
  });

  it("maps missing sphinx dependencies to a clear error", async () => {
    const docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });
    execaMock.mockRejectedValueOnce(
      Object.assign(new Error("Command failed"), {
        stderr: "No module named sphinx",
      })
    );

    const repo: RepoConfig = {
      name: "django-docs",
      repo: "https://example.com/repo",
      sourcePath: "docs",
      preprocess: {
        type: "sphinx",
      },
    };

    await expect(runPreprocess(tempDir, repo)).rejects.toThrow(
      "Sphinx is not installed"
    );
  });

  it("maps missing sphinx when stderr uses python path prefix", async () => {
    const docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });
    execaMock.mockRejectedValueOnce(
      Object.assign(new Error("Command failed"), {
        stderr: "/opt/homebrew/bin/python3.14: No module named sphinx",
      })
    );

    const repo: RepoConfig = {
      name: "django-docs",
      repo: "https://example.com/repo",
      sourcePath: "docs",
      preprocess: {
        type: "sphinx",
      },
    };

    await expect(runPreprocess(tempDir, repo)).rejects.toThrow(
      "Sphinx is not installed"
    );
  });

  it("maps missing sphinx markdown builder module to a clear error", async () => {
    const docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });
    execaMock.mockRejectedValueOnce(
      Object.assign(new Error("Command failed"), {
        stderr: "No module named 'sphinx_markdown_builder'",
      })
    );

    const repo: RepoConfig = {
      name: "django-docs",
      repo: "https://example.com/repo",
      sourcePath: "docs",
      preprocess: {
        type: "sphinx",
      },
    };

    await expect(runPreprocess(tempDir, repo)).rejects.toThrow(
      "Markdown builder is unavailable"
    );
  });
});
