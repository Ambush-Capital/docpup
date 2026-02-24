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
  toMdUrl,
} from "../src/url-fetcher.js";

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><main>${body}</main><nav><a href="/">Nav</a></nav></body></html>`;
}

type UrlMockConfig = {
  markdown?: string;
  html?: string;
  /** Markdown content served at the .md URL variant (e.g. /overview.md) */
  mdUrl?: string;
  failStatus?: number;
};

/**
 * Set up argument-aware fetch mocks. Routes responses by URL and Accept header,
 * so concurrent fetches resolve correctly regardless of call order.
 * Also handles .md URL variants: if config has `mdUrl`, the corresponding
 * .md URL will serve that markdown content.
 */
function setupMocks(urlMap: Record<string, UrlMockConfig>) {
  // Build a secondary map for .md URL variants
  const mdUrlMap = new Map<string, string>();
  for (const [url, config] of Object.entries(urlMap)) {
    if (config.mdUrl) {
      const mdUrl = toMdUrl(url);
      if (mdUrl) mdUrlMap.set(mdUrl, config.mdUrl);
    }
  }

  mockFetch.mockImplementation(async (url: string, init?: { headers?: Record<string, string> }) => {
    const accept = init?.headers?.Accept ?? "";

    // Check if this is a .md URL variant request
    const mdContent = mdUrlMap.get(url);
    if (mdContent) {
      return {
        ok: true,
        status: 200,
        text: async () => mdContent,
        headers: new Headers({ "content-type": "text/plain" }),
      };
    }

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

  it("uses .md URL variant when available", async () => {
    setupMocks({
      "https://example.com/docs/overview": {
        mdUrl: "# Overview\n\nMarkdown from .md URL",
        html: htmlPage("Overview", "<h1>Overview</h1><p>HTML version</p>"),
      },
    });

    const outputDir = path.join(tempDir, "output");
    await fetchUrlSource({
      urls: ["https://example.com/docs/overview"],
      name: "test-docs",
      outputDir,
    });

    const files = await fs.readdir(outputDir);
    const content = await fs.readFile(path.join(outputDir, files[0]), "utf8");
    // Should use the .md URL content, not the HTML fallback
    expect(content).toBe("# Overview\n\nMarkdown from .md URL");
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

    // 3 calls: markdown header + .md URL + HTML fallback, but only for the one unique URL
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const files = await fs.readdir(outputDir);
    expect(files).toHaveLength(1);
  });

  it("avoids filename collisions when titles already include numeric suffixes", async () => {
    setupMocks({
      "https://example.com/one": {
        markdown: "# A\n\nfirst",
      },
      "https://example.com/two": {
        markdown: "# A-2\n\nsecond",
      },
      "https://example.com/three": {
        markdown: "# A\n\nthird",
      },
    });

    const outputDir = path.join(tempDir, "output");
    await fetchUrlSource({
      urls: [
        "https://example.com/one",
        "https://example.com/two",
        "https://example.com/three",
      ],
      name: "test-docs",
      outputDir,
    });

    const files = (await fs.readdir(outputDir)).sort();
    expect(files).toEqual(["a-2.md", "a-3.md", "a.md"]);

    const contents = await Promise.all(
      files.map((file) => fs.readFile(path.join(outputDir, file), "utf8"))
    );
    expect(contents.join("\n")).toContain("first");
    expect(contents.join("\n")).toContain("second");
    expect(contents.join("\n")).toContain("third");
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

describe("toMdUrl", () => {
  it("appends .md to a path without extension", () => {
    expect(toMdUrl("https://example.com/docs/overview")).toBe(
      "https://example.com/docs/overview.md"
    );
  });

  it("replaces .html extension with .md", () => {
    expect(toMdUrl("https://example.com/docs/overview.html")).toBe(
      "https://example.com/docs/overview.md"
    );
  });

  it("replaces .htm extension with .md", () => {
    expect(toMdUrl("https://example.com/docs/overview.htm")).toBe(
      "https://example.com/docs/overview.md"
    );
  });

  it("strips trailing slash and appends .md", () => {
    expect(toMdUrl("https://example.com/docs/overview/")).toBe(
      "https://example.com/docs/overview.md"
    );
  });

  it("returns null if URL already ends in .md", () => {
    expect(toMdUrl("https://example.com/docs/overview.md")).toBeNull();
  });

  it("preserves query string and hash", () => {
    expect(toMdUrl("https://example.com/docs/overview?v=2#section")).toBe(
      "https://example.com/docs/overview.md?v=2#section"
    );
  });
});
