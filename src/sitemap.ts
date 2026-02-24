import * as cheerio from "cheerio";
import { docpupFetch } from "./utils.js";
import type { SitemapPathRule } from "./types.js";

export type SitemapResolveArgs = {
  sitemapUrl: string;
  paths?: SitemapPathRule[];
};

export function parseSitemapUrls(xml: string): string[] {
  const $ = cheerio.load(xml, { xml: true });
  const urls: string[] = [];
  $("url > loc").each((_, el) => {
    const text = $(el).text().trim();
    if (text) urls.push(text);
  });
  return urls;
}

export function isSitemapIndex(xml: string): boolean {
  const $ = cheerio.load(xml, { xml: true });
  return $("sitemapindex").length > 0;
}

export function parseSitemapIndexUrls(xml: string): string[] {
  const $ = cheerio.load(xml, { xml: true });
  const urls: string[] = [];
  $("sitemapindex > sitemap > loc").each((_, el) => {
    const text = $(el).text().trim();
    if (text) urls.push(text);
  });
  return urls;
}

function normalizePath(pathname: string): string {
  return pathname.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function filterUrls(
  urls: string[],
  paths: SitemapPathRule[]
): string[] {
  if (paths.length === 0) return urls;

  const rules = paths.map((p) => ({
    prefix: normalizePath(p.prefix),
    subs: new Set(p.subs ?? []),
  }));

  return urls.filter((url) => {
    let pathname: string;
    try {
      pathname = new URL(url).pathname;
    } catch {
      return false;
    }
    const normalized = normalizePath(pathname);

    for (const rule of rules) {
      // Exact match on the prefix page itself
      if (normalized === rule.prefix) return true;

      // Must be under the prefix
      if (!normalized.startsWith(rule.prefix + "/")) continue;

      const relative = normalized.slice(rule.prefix.length + 1);
      const segments = relative.split("/").filter(Boolean);

      if (segments.length === 0) return true;
      if (segments.length === 1) return true; // first-level child

      // Multi-segment: only include if first segment is an opted-in sub
      if (rule.subs.has(segments[0])) return true;
    }

    return false;
  });
}

async function fetchSitemap(url: string): Promise<string> {
  const response = await docpupFetch(url, { accept: "application/xml" });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching sitemap: ${url}`);
  }

  return response.text();
}

export async function resolveSitemapUrls(
  args: SitemapResolveArgs
): Promise<string[]> {
  const xml = await fetchSitemap(args.sitemapUrl);

  let allUrls: string[];

  if (isSitemapIndex(xml)) {
    const childSitemapUrls = parseSitemapIndexUrls(xml);
    const childResults = await Promise.all(
      childSitemapUrls.map(async (childUrl) => {
        try {
          const childXml = await fetchSitemap(childUrl);
          return parseSitemapUrls(childXml);
        } catch {
          console.warn(`Warning: failed to fetch child sitemap: ${childUrl}`);
          return [];
        }
      })
    );
    allUrls = childResults.flat();
  } else {
    allUrls = parseSitemapUrls(xml);
  }

  if (allUrls.length === 0) {
    throw new Error(`No URLs found in sitemap: ${args.sitemapUrl}`);
  }

  return args.paths && args.paths.length > 0
    ? filterUrls(allUrls, args.paths)
    : allUrls;
}
