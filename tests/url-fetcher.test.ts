import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  fetchUrlSource,
  stripCommonAffixes,
  slugify,
  findCommonPrefix,
  findCommonSuffix,
} from "../src/url-fetcher.js";

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><main>${body}</main><nav><a href="/">Nav</a></nav></body></html>`;
}

type UrlMockConfig = {
  markdown?: string;
  html?: string;
  failStatus?: number;
};

/**
 * Set up argument-aware fetch mocks. Routes responses by URL and Accept header,
 * so concurrent fetches resolve correctly regardless of call order.
 */
function setupMocks(urlMap: Record<string, UrlMockConfig>) {
  mockFetch.mockImplementation(async (url: string, init?: { headers?: Record<string, string> }) => {
    const accept = init?.headers?.Accept ?? "";
    const config = urlMap[url];

    if (!config || config.failStatus) {
      const status = config?.failStatus ?? 404;
      return { ok: false, status, headers: new Headers() };
    }

    if (accept === "text/markdown" && config.markdown) {
      return {
        ok: true,
        status: 200,
        text: async () => config.markdown,
        headers: new Headers({ "content-type": "text/markdown" }),
      };
    }

    // Markdown attempt but no markdown available — return HTML content-type
    if (accept === "text/markdown") {
      return {
        ok: true,
        status: 200,
        text: async () => config.html ?? "",
        headers: new Headers({ "content-type": "text/html" }),
      };
    }

    // HTML request
    if (config.html) {
      return {
        ok: true,
        status: 200,
        text: async () => config.html,
        headers: new Headers({ "content-type": "text/html" }),
      };
    }

    return { ok: false, status: 404, headers: new Headers() };
  });
}

describe("fetchUrlSource", () => {
  let tempDir: string;

  beforeEach(async () => {
    mockFetch.mockReset();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docpup-url-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("fetches URLs and converts HTML to markdown", async () => {
    setupMocks({
      "https://example.com/overview": {
        html: htmlPage("Overview - My Docs", "<h1>Overview</h1><p>Hello world</p>"),
      },
      "https://example.com/guide": {
        html: htmlPage("Guide - My Docs", "<h1>Guide</h1><p>Step by step</p>"),
      },
    });

    const outputDir = path.join(tempDir, "output");
    await fetchUrlSource({
      urls: ["https://example.com/overview", "https://example.com/guide"],
      name: "test-docs",
      outputDir,
    });

    const files = (await fs.readdir(outputDir)).sort();
    expect(files).toHaveLength(2);
    expect(files).toEqual(["guide.md", "overview.md"]);

    const overview = await fs.readFile(path.join(outputDir, "overview.md"), "utf8");
    expect(overview).toContain("# Overview");
    expect(overview).toContain("Hello world");
  });

  it("uses markdown directly when server supports Accept: text/markdown", async () => {
    setupMocks({
      "https://example.com/overview": {
        markdown: "# Overview\n\nHello from markdown",
      },
      "https://example.com/guide": {
        markdown: "# Guide\n\nStep by step",
      },
    });

    const outputDir = path.join(tempDir, "output");
    await fetchUrlSource({
      urls: ["https://example.com/overview", "https://example.com/guide"],
      name: "test-docs",
      outputDir,
    });

    const files = (await fs.readdir(outputDir)).sort();
    expect(files).toHaveLength(2);

    const overview = await fs.readFile(path.join(outputDir, "overview.md"), "utf8");
    expect(overview).toBe("# Overview\n\nHello from markdown");
    // Only 2 fetch calls total (one per URL), no HTML fallback needed
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to HTML when markdown response has wrong content-type", async () => {
    setupMocks({
      "https://example.com/page": {
        html: htmlPage("Page", "<h1>Fallback</h1><p>HTML content</p>"),
      },
    });

    const outputDir = path.join(tempDir, "output");
    await fetchUrlSource({
      urls: ["https://example.com/page"],
      name: "test-docs",
      outputDir,
    });

    const files = await fs.readdir(outputDir);
    const content = await fs.readFile(path.join(outputDir, files[0]), "utf8");
    expect(content).toContain("# Fallback");
    expect(content).toContain("HTML content");
  });

  it("strips nav, header, and footer elements", async () => {
    setupMocks({
      "https://example.com/page": {
        html: `<!doctype html><html><head><title>Page</title></head><body>
          <header><div>Site Header</div></header>
          <nav><a href="/">Home</a></nav>
          <main><h1>Content</h1><p>Real content here</p></main>
          <footer><div>Site Footer</div></footer>
        </body></html>`,
      },
    });

    const outputDir = path.join(tempDir, "output");
    await fetchUrlSource({
      urls: ["https://example.com/page"],
      name: "test-docs",
      outputDir,
    });

    const files = await fs.readdir(outputDir);
    expect(files).toHaveLength(1);

    const content = await fs.readFile(path.join(outputDir, files[0]), "utf8");
    expect(content).toContain("Real content here");
    expect(content).not.toContain("Site Header");
    expect(content).not.toContain("Site Footer");
    expect(content).not.toContain("Home");
  });

  it("respects custom selector", async () => {
    setupMocks({
      "https://example.com/page": {
        html: `<!doctype html><html><head><title>Page</title></head><body>
          <main><h1>Main</h1></main>
          <div class="docs-content"><h1>Docs</h1><p>Target content</p></div>
        </body></html>`,
      },
    });

    const outputDir = path.join(tempDir, "output");
    await fetchUrlSource({
      urls: ["https://example.com/page"],
      name: "test-docs",
      outputDir,
      selector: ".docs-content",
    });

    const files = await fs.readdir(outputDir);
    const content = await fs.readFile(path.join(outputDir, files[0]), "utf8");
    expect(content).toContain("# Docs");
    expect(content).toContain("Target content");
    expect(content).not.toContain("# Main");
  });

  it("handles partial failures gracefully", async () => {
    setupMocks({
      "https://example.com/a": {
        html: htmlPage("Page A", "<h1>A</h1><p>Content A</p>"),
      },
      "https://example.com/b": { failStatus: 404 },
    });

    const outputDir = path.join(tempDir, "output");
    await fetchUrlSource({
      urls: ["https://example.com/a", "https://example.com/b"],
      name: "test-docs",
      outputDir,
    });

    const files = await fs.readdir(outputDir);
    expect(files).toHaveLength(1);
  });

  it("throws when all URLs fail", async () => {
    setupMocks({
      "https://example.com/a": { failStatus: 500 },
      "https://example.com/b": { failStatus: 500 },
    });

    const outputDir = path.join(tempDir, "output");
    await expect(
      fetchUrlSource({
        urls: ["https://example.com/a", "https://example.com/b"],
        name: "test-docs",
        outputDir,
      })
    ).rejects.toThrow("All URL fetches failed");
  });

  it("deduplicates identical URLs", async () => {
    setupMocks({
      "https://example.com/page": {
        html: htmlPage("Page", "<h1>Hello</h1>"),
      },
    });

    const outputDir = path.join(tempDir, "output");
    await fetchUrlSource({
      urls: [
        "https://example.com/page",
        "https://example.com/page",
      ],
      name: "test-docs",
      outputDir,
    });

    // 2 calls: markdown attempt + HTML fallback, but only for the one unique URL
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const files = await fs.readdir(outputDir);
    expect(files).toHaveLength(1);
  });
});

describe("stripCommonAffixes", () => {
  it("strips common suffix at separator boundary", () => {
    const titles = [
      "Overview - Claude Code Docs",
      "Quickstart - Claude Code Docs",
      "Guide - Claude Code Docs",
    ];
    const result = stripCommonAffixes(titles);
    expect(result).toEqual(["Overview", "Quickstart", "Guide"]);
  });

  it("strips common prefix at separator boundary", () => {
    const titles = [
      "Claude Docs - Overview",
      "Claude Docs - Quickstart",
      "Claude Docs - Guide",
    ];
    const result = stripCommonAffixes(titles);
    expect(result).toEqual(["Overview", "Quickstart", "Guide"]);
  });

  it("returns originals when no common separator-boundary affix", () => {
    const titles = ["Alpha", "Beta", "Gamma"];
    const result = stripCommonAffixes(titles);
    expect(result).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("returns single title unchanged", () => {
    expect(stripCommonAffixes(["Hello"])).toEqual(["Hello"]);
  });

  it("handles pipe separator", () => {
    const titles = ["Overview | Docs", "Guide | Docs"];
    const result = stripCommonAffixes(titles);
    expect(result).toEqual(["Overview", "Guide"]);
  });
});

describe("slugify", () => {
  it("converts to lowercase kebab-case", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("strips special characters", () => {
    expect(slugify("What's New?")).toBe("what-s-new");
  });

  it("truncates long strings", () => {
    const long = "a".repeat(150);
    expect(slugify(long).length).toBeLessThanOrEqual(100);
  });

  it("returns 'page' for empty input", () => {
    expect(slugify("")).toBe("page");
  });
});

describe("findCommonPrefix", () => {
  it("finds prefix at separator boundary", () => {
    expect(findCommonPrefix(["Docs - A", "Docs - B"])).toBe("Docs - ");
  });

  it("returns empty for no common prefix", () => {
    expect(findCommonPrefix(["Alpha", "Beta"])).toBe("");
  });

  it("returns empty for single string", () => {
    expect(findCommonPrefix(["Hello"])).toBe("");
  });
});

describe("findCommonSuffix", () => {
  it("finds suffix at separator boundary", () => {
    expect(findCommonSuffix(["A - Docs", "B - Docs"])).toBe(" - Docs");
  });

  it("returns empty for no common suffix", () => {
    expect(findCommonSuffix(["Alpha", "Beta"])).toBe("");
  });
});
