import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  filterUrls,
  parseSitemapUrls,
  parseSitemapIndexUrls,
  isSitemapIndex,
  resolveSitemapUrls,
} from "../src/sitemap.js";

function xmlResponse(body: string) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
    headers: new Headers({ "content-type": "application/xml" }),
  };
}

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/docs/en/api/overview</loc></url>
  <url><loc>https://example.com/docs/en/api/errors</loc></url>
  <url><loc>https://example.com/docs/en/api/beta-headers</loc></url>
  <url><loc>https://example.com/docs/en/api/sdks/python</loc></url>
  <url><loc>https://example.com/docs/en/api/sdks/typescript</loc></url>
  <url><loc>https://example.com/docs/en/api/sdks/go</loc></url>
  <url><loc>https://example.com/docs/en/api/skills/create-skill</loc></url>
  <url><loc>https://example.com/docs/en/api/skills/list-skills</loc></url>
  <url><loc>https://example.com/docs/en/guides/getting-started</loc></url>
</urlset>`;

const SITEMAP_INDEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-api.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-guides.xml</loc></sitemap>
</sitemapindex>`;

const CHILD_SITEMAP_API = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/docs/en/api/overview</loc></url>
  <url><loc>https://example.com/docs/en/api/errors</loc></url>
</urlset>`;

const CHILD_SITEMAP_GUIDES = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/docs/en/guides/intro</loc></url>
</urlset>`;

describe("parseSitemapUrls", () => {
  it("extracts URLs from standard sitemap XML", () => {
    const urls = parseSitemapUrls(SITEMAP_XML);
    expect(urls).toHaveLength(9);
    expect(urls[0]).toBe("https://example.com/docs/en/api/overview");
  });

  it("returns empty array for empty sitemap", () => {
    const xml = `<?xml version="1.0"?><urlset></urlset>`;
    expect(parseSitemapUrls(xml)).toEqual([]);
  });

  it("trims whitespace from loc elements", () => {
    const xml = `<?xml version="1.0"?>
      <urlset><url><loc>  https://example.com/page  </loc></url></urlset>`;
    expect(parseSitemapUrls(xml)).toEqual(["https://example.com/page"]);
  });
});

describe("isSitemapIndex", () => {
  it("returns true for sitemap index XML", () => {
    expect(isSitemapIndex(SITEMAP_INDEX_XML)).toBe(true);
  });

  it("returns false for regular sitemap XML", () => {
    expect(isSitemapIndex(SITEMAP_XML)).toBe(false);
  });
});

describe("parseSitemapIndexUrls", () => {
  it("extracts child sitemap URLs", () => {
    const urls = parseSitemapIndexUrls(SITEMAP_INDEX_XML);
    expect(urls).toEqual([
      "https://example.com/sitemap-api.xml",
      "https://example.com/sitemap-guides.xml",
    ]);
  });
});

describe("filterUrls", () => {
  const allUrls = [
    "https://example.com/docs/en/api/overview",
    "https://example.com/docs/en/api/errors",
    "https://example.com/docs/en/api/beta-headers",
    "https://example.com/docs/en/api/sdks/python",
    "https://example.com/docs/en/api/sdks/typescript",
    "https://example.com/docs/en/api/sdks/go",
    "https://example.com/docs/en/api/skills/create-skill",
    "https://example.com/docs/en/api/skills/list-skills",
    "https://example.com/docs/en/guides/getting-started",
  ];

  it("includes first-level children of a prefix", () => {
    const result = filterUrls(allUrls, [{ prefix: "docs/en/api" }]);
    expect(result).toContain("https://example.com/docs/en/api/overview");
    expect(result).toContain("https://example.com/docs/en/api/errors");
    expect(result).toContain("https://example.com/docs/en/api/beta-headers");
  });

  it("excludes nested children by default", () => {
    const result = filterUrls(allUrls, [{ prefix: "docs/en/api" }]);
    expect(result).not.toContain("https://example.com/docs/en/api/sdks/python");
    expect(result).not.toContain("https://example.com/docs/en/api/skills/create-skill");
  });

  it("includes opted-in subs at full depth", () => {
    const result = filterUrls(allUrls, [
      { prefix: "docs/en/api", subs: ["sdks"] },
    ]);
    expect(result).toContain("https://example.com/docs/en/api/sdks/python");
    expect(result).toContain("https://example.com/docs/en/api/sdks/typescript");
    expect(result).toContain("https://example.com/docs/en/api/sdks/go");
    // skills is not in subs
    expect(result).not.toContain("https://example.com/docs/en/api/skills/create-skill");
  });

  it("includes multiple opted-in subs", () => {
    const result = filterUrls(allUrls, [
      { prefix: "docs/en/api", subs: ["sdks", "skills"] },
    ]);
    expect(result).toContain("https://example.com/docs/en/api/sdks/python");
    expect(result).toContain("https://example.com/docs/en/api/skills/create-skill");
  });

  it("includes the prefix page itself", () => {
    const urls = ["https://example.com/docs/en/api", ...allUrls];
    const result = filterUrls(urls, [{ prefix: "docs/en/api" }]);
    expect(result).toContain("https://example.com/docs/en/api");
  });

  it("supports multiple prefix rules", () => {
    const result = filterUrls(allUrls, [
      { prefix: "docs/en/api" },
      { prefix: "docs/en/guides" },
    ]);
    expect(result).toContain("https://example.com/docs/en/api/overview");
    expect(result).toContain("https://example.com/docs/en/guides/getting-started");
  });

  it("returns all URLs when paths array is empty", () => {
    const result = filterUrls(allUrls, []);
    expect(result).toEqual(allUrls);
  });

  it("excludes URLs that match no prefix", () => {
    const result = filterUrls(allUrls, [{ prefix: "docs/en/guides" }]);
    expect(result).toEqual([
      "https://example.com/docs/en/guides/getting-started",
    ]);
  });

  it("normalizes leading and trailing slashes in prefix", () => {
    const result = filterUrls(allUrls, [{ prefix: "/docs/en/api/" }]);
    expect(result).toContain("https://example.com/docs/en/api/overview");
    expect(result).not.toContain("https://example.com/docs/en/api/sdks/python");
  });

  it("handles deeply nested sub-paths", () => {
    const urls = [
      "https://example.com/docs/en/api/sdks/python/quickstart/setup",
    ];
    const result = filterUrls(urls, [
      { prefix: "docs/en/api", subs: ["sdks"] },
    ]);
    expect(result).toContain(
      "https://example.com/docs/en/api/sdks/python/quickstart/setup"
    );
  });

  it("skips invalid URLs gracefully", () => {
    const urls = ["not-a-url", "https://example.com/docs/en/api/overview"];
    const result = filterUrls(urls, [{ prefix: "docs/en/api" }]);
    expect(result).toEqual(["https://example.com/docs/en/api/overview"]);
  });
});

describe("resolveSitemapUrls", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("fetches and returns filtered URLs from a sitemap", async () => {
    mockFetch.mockResolvedValueOnce(xmlResponse(SITEMAP_XML));

    const urls = await resolveSitemapUrls({
      sitemapUrl: "https://example.com/sitemap.xml",
      paths: [{ prefix: "docs/en/api", subs: ["sdks"] }],
    });

    expect(urls).toContain("https://example.com/docs/en/api/overview");
    expect(urls).toContain("https://example.com/docs/en/api/sdks/python");
    expect(urls).not.toContain("https://example.com/docs/en/api/skills/create-skill");
    expect(urls).not.toContain("https://example.com/docs/en/guides/getting-started");
  });

  it("returns all URLs when paths is omitted", async () => {
    mockFetch.mockResolvedValueOnce(xmlResponse(SITEMAP_XML));

    const urls = await resolveSitemapUrls({
      sitemapUrl: "https://example.com/sitemap.xml",
    });

    expect(urls).toHaveLength(9);
  });

  it("handles sitemap index by fetching child sitemaps", async () => {
    mockFetch
      .mockResolvedValueOnce(xmlResponse(SITEMAP_INDEX_XML))
      .mockResolvedValueOnce(xmlResponse(CHILD_SITEMAP_API))
      .mockResolvedValueOnce(xmlResponse(CHILD_SITEMAP_GUIDES));

    const urls = await resolveSitemapUrls({
      sitemapUrl: "https://example.com/sitemap.xml",
    });

    expect(urls).toEqual([
      "https://example.com/docs/en/api/overview",
      "https://example.com/docs/en/api/errors",
      "https://example.com/docs/en/guides/intro",
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("continues when a child sitemap fails", async () => {
    mockFetch
      .mockResolvedValueOnce(xmlResponse(SITEMAP_INDEX_XML))
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(xmlResponse(CHILD_SITEMAP_GUIDES));

    const urls = await resolveSitemapUrls({
      sitemapUrl: "https://example.com/sitemap.xml",
    });

    expect(urls).toEqual(["https://example.com/docs/en/guides/intro"]);
  });

  it("throws when sitemap has no URLs", async () => {
    const emptyXml = `<?xml version="1.0"?><urlset></urlset>`;
    mockFetch.mockResolvedValueOnce(xmlResponse(emptyXml));

    await expect(
      resolveSitemapUrls({ sitemapUrl: "https://example.com/sitemap.xml" })
    ).rejects.toThrow("No URLs found in sitemap");
  });

  it("throws when sitemap fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers(),
    });

    await expect(
      resolveSitemapUrls({ sitemapUrl: "https://example.com/sitemap.xml" })
    ).rejects.toThrow("HTTP 404");
  });
});
