import type { DocTree } from "./types.js";

export function buildIndex(
  tree: DocTree,
  repoName: string,
  docsRootRelPath: string
): string {
  const upperName = repoName.toUpperCase();
  const startMarker = `<!-- ${upperName}-AGENTS-MD-START -->`;
  const endMarker = `<!-- ${upperName}-AGENTS-MD-END -->`;

  const header = `[${repoName} Docs Index]`;
  const root = `root: ${docsRootRelPath}`;
  const warning = `STOP. What you remember about ${repoName} may be WRONG for this project. Always search docs and read before any task.`;

  const dirEntries: string[] = [];

  const sortedDirs = Array.from(tree.keys()).sort((a, b) => {
    if (a === "(root)") return -1;
    if (b === "(root)") return 1;
    return a.localeCompare(b);
  });

  for (const dir of sortedDirs) {
    const files = tree.get(dir);
    if (!files || files.length === 0) continue;

    const sortedFiles = [...files].sort((a, b) => a.localeCompare(b));
    const fileList = `{${sortedFiles.join(",")}}`;
    dirEntries.push(`(${dir}):${fileList}`);
  }

  const content = [header, root, warning, ...dirEntries].join("|");

  return `${startMarker}${content}${endMarker}`;
}
