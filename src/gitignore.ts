import fs from "node:fs/promises";
import path from "node:path";

export async function updateGitignore(args: {
  repoRoot: string;
  docsEntry?: string;
  indexEntry?: string;
  sectionHeader: string;
}) {
  const gitignorePath = path.join(args.repoRoot, ".gitignore");
  const existingContent = await fs
    .readFile(gitignorePath, "utf8")
    .catch(() => "");
  const lines = existingContent.split(/\r?\n/);
  const headerLine = `# ${args.sectionHeader}`;

  const entries = [args.docsEntry, args.indexEntry].filter(
    (entry): entry is string => Boolean(entry)
  );
  if (entries.length === 0) {
    return;
  }

  const existing = new Set(lines.map((line) => line.trim()));
  let headerIndex = lines.findIndex((line) => line.trim() === headerLine);

  if (headerIndex === -1) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== "") {
      lines.push("");
    }
    lines.push(headerLine);
    headerIndex = lines.length - 1;
  }

  let insertOffset = 0;
  for (const entry of entries) {
    if (existing.has(entry)) {
      continue;
    }
    lines.splice(headerIndex + 1 + insertOffset, 0, entry);
    insertOffset += 1;
    existing.add(entry);
  }

  const updated = lines.join("\n");
  await fs.writeFile(gitignorePath, updated.endsWith("\n") ? updated : `${updated}\n`);
}
