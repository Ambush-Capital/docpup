import fs from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import * as cheerio from "cheerio";
import { selectContent, createTurndownService } from "./preprocess.js";

export type UrlFetchArgs = {
  urls: string[];
  name: string;
  outputDir: string;
  selector?: string;
  concurrency?: number;
};

type PageData =
  | { url: string; title: string; markdown: string; kind: "markdown" }
  | { url: string; title: string; $: cheerio.CheerioAPI; kind: "html" };

async function fetchMarkdown(url: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "docpup/0.1",
      Accept: "text/markdown",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/markdown") && !contentType.includes("text/x-markdown")) {
    return null;
  }

  return response.text();
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "docpup/0.1",
      Accept: "text/html",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  return response.text();
}

function extractTitleFromMarkdown(md: string): string {
  const match = md.match(/^#\s+(.+)/m);
  return match?.[1]?.trim() || "untitled";
}

function extractTitle($: cheerio.CheerioAPI): string {
  return $("title").first().text().trim() || "untitled";
}

async function fetchPage(url: string): Promise<PageData> {
  // Try markdown first — if the server supports it, skip HTML processing entirely
  const md = await fetchMarkdown(url);
  if (md) {
    return { url, title: extractTitleFromMarkdown(md), markdown: md, kind: "markdown" };
  }

  // Fall back to HTML fetch + conversion
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const title = extractTitle($);
  return { url, title, $, kind: "html" };
}

export function findCommonPrefix(strings: string[]): string {
  if (strings.length <= 1) return "";
  const sorted = [...strings].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  let i = 0;
  while (i < first.length && first[i] === last[i]) i++;
  const raw = first.slice(0, i);
  // Only strip at a separator boundary
  const separators = [" - ", " | ", ": ", " \u2014 ", " \u2013 "];
  let best = "";
  for (const sep of separators) {
    const idx = raw.lastIndexOf(sep);
    if (idx >= 0) {
      const candidate = raw.slice(0, idx + sep.length);
      if (candidate.length > best.length) best = candidate;
    }
  }
  return best;
}

export function findCommonSuffix(strings: string[]): string {
  if (strings.length <= 1) return "";
  const reversed = strings.map((s) => [...s].reverse().join(""));
  const sorted = [...reversed].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  let i = 0;
  while (i < first.length && first[i] === last[i]) i++;
  const rawReversed = first.slice(0, i);
  const raw = [...rawReversed].reverse().join("");
  // Only strip at a separator boundary
  const separators = [" - ", " | ", ": ", " \u2014 ", " \u2013 "];
  let best = "";
  for (const sep of separators) {
    const idx = raw.indexOf(sep);
    if (idx >= 0) {
      const candidate = raw.slice(idx);
      if (candidate.length > best.length) best = candidate;
    }
  }
  return best;
}

export function stripCommonAffixes(titles: string[]): string[] {
  if (titles.length <= 1) return titles;
  const prefix = findCommonPrefix(titles);
  const suffix = findCommonSuffix(titles);
  return titles.map((t) => {
    let result = t;
    if (prefix && result.startsWith(prefix)) result = result.slice(prefix.length);
    if (suffix && result.endsWith(suffix))
      result = result.slice(0, result.length - suffix.length);
    return result.trim() || t;
  });
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "page"
  );
}

export async function fetchUrlSource(args: UrlFetchArgs): Promise<void> {
  const { urls, name, outputDir, selector, concurrency = 5 } = args;
  const uniqueUrls = [...new Set(urls)];
  const limit = pLimit(concurrency);

  await fs.mkdir(outputDir, { recursive: true });

  const turndown = createTurndownService();

  // Phase 1: Fetch all pages (tries markdown first, falls back to HTML)
  const pages: PageData[] = [];
  const warnings: string[] = [];

  const fetchResults = await Promise.allSettled(
    uniqueUrls.map((url) => limit(() => fetchPage(url)))
  );

  for (let i = 0; i < fetchResults.length; i++) {
    const result = fetchResults[i];
    if (result.status === "fulfilled") {
      pages.push(result.value);
    } else {
      warnings.push(`Failed to fetch ${uniqueUrls[i]}: ${result.reason}`);
    }
  }

  if (warnings.length > 0) {
    for (const w of warnings) {
      console.warn(w);
    }
  }

  if (pages.length === 0) {
    throw new Error(`All URL fetches failed for ${name}`);
  }

  // Phase 2: Compute filenames from titles
  const rawTitles = pages.map((p) => p.title);
  const strippedTitles = stripCommonAffixes(rawTitles);

  const usedNames = new Set<string>();
  const fileNames: string[] = strippedTitles.map((title, i) => {
    let slug = slugify(title);
    if (usedNames.has(slug)) {
      slug = `${slug}-${i}`;
    }
    usedNames.add(slug);
    return `${slug}.md`;
  });

  // Phase 3: Convert to markdown (if needed) and write files
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    let markdown: string;

    if (page.kind === "markdown") {
      markdown = page.markdown;
    } else {
      const selection = selectContent(page.$, selector);
      selection.find("script,style,nav,header,footer").remove();
      const htmlSource = selection.html() ?? "";
      markdown = turndown.turndown(htmlSource);
    }

    const filePath = path.join(outputDir, fileNames[i]);
    await fs.writeFile(filePath, markdown, "utf8");
  }
}
