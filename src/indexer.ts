function toMarkerName(name: string) {
  return name.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "-");
}

function escapeToken(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/[|{},:]/g, (char) => `\\${char}`);
}

export function buildIndex(
  tree: Map<string, string[]>,
  repoName: string,
  docsRootRelPath: string
): string {
  const markerName = toMarkerName(repoName);
  const warning = `STOP. What you remember about ${repoName} may be WRONG for this project. Always search docs and read before any task.`;

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

  return `${header}[${repoName} Docs Index]|${root}|${warning}${entriesSection}${footer}`;
}
