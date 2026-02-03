import type { ContentType } from "./types.js";

function toMarkerName(name: string) {
  return name.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "-");
}

function escapeToken(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/[|{},:]/g, (char) => `\\${char}`);
}

function getIndexTitle(repoName: string, contentType: ContentType): string {
  if (contentType === "source") {
    return `${repoName} Source Index`;
  }
  return `${repoName} Docs Index`;
}

function getWarningMessage(repoName: string, contentType: ContentType): string {
  if (contentType === "source") {
    return `STOP. This is source code from ${repoName}. Search and read files before making changes.`;
  }
  return `STOP. What you remember about ${repoName} may be WRONG for this project. Always search docs and read before any task.`;
}

export function buildIndex(
  tree: Map<string, string[]>,
  repoName: string,
  docsRootRelPath: string,
  contentType: ContentType = "docs"
): string {
  const markerName = toMarkerName(repoName);
  const title = getIndexTitle(repoName, contentType);
  const warning = getWarningMessage(repoName, contentType);

  const entries = Array.from(tree.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, files]) => {
      const label = dir === "" ? "(root)" : dir;
      const fileList = [...files]
        .sort((a, b) => a.localeCompare(b))
        .map(escapeToken)
        .join(",");
      return `${escapeToken(label)}:{${fileList}}`;
    })
    .join("|");

  const root = `root: ${escapeToken(docsRootRelPath)}`;
  const header = `<!-- ${markerName}-AGENTS-MD-START -->`;
  const footer = `<!-- ${markerName}-AGENTS-MD-END -->`;
  const entriesSection = entries ? `|${entries}` : "";

  return `${header}[${title}]|${root}|${warning}${entriesSection}${footer}`;
}
