import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function updateGitignore(args: {
  repoRoot: string;
  entries: string[];
  sectionHeader: string;
}): Promise<void> {
  const { repoRoot, entries, sectionHeader } = args;

  if (entries.length === 0) {
    return;
  }

  const gitignorePath = path.join(repoRoot, ".gitignore");

  let content = "";
  try {
    content = await readFile(gitignorePath, "utf-8");
  } catch {
    // File doesn't exist, start fresh
  }

  const headerLine = `# ${sectionHeader}`;
  const lines = content.split("\n");

  let sectionStart = -1;
  let sectionEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === headerLine) {
      sectionStart = i;
      sectionEnd = i + 1;

      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j].trim();
        if (line === "" || line.startsWith("#")) {
          if (line.startsWith("#") && line !== headerLine) {
            break;
          }
          sectionEnd = j + 1;
          if (line === "") {
            break;
          }
        } else {
          sectionEnd = j + 1;
        }
      }
      break;
    }
  }

  const existingEntries = new Set<string>();
  if (sectionStart !== -1) {
    for (let i = sectionStart + 1; i < sectionEnd; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith("#")) {
        existingEntries.add(line);
      }
    }
  }

  const newEntries = entries.filter((e) => !existingEntries.has(e));

  if (newEntries.length === 0) {
    return;
  }

  if (sectionStart === -1) {
    const sectionContent = [
      "",
      headerLine,
      ...entries,
      "",
    ].join("\n");

    const trimmedContent = content.trimEnd();
    const newContent = trimmedContent
      ? trimmedContent + sectionContent
      : sectionContent.trimStart();

    await writeFile(gitignorePath, newContent);
  } else {
    const allEntries = [...existingEntries, ...newEntries];
    const sectionLines = [headerLine, ...allEntries];

    const before = lines.slice(0, sectionStart);
    const after = lines.slice(sectionEnd);

    const newLines = [...before, ...sectionLines, "", ...after];

    let newContent = newLines.join("\n");
    newContent = newContent.replace(/\n{3,}/g, "\n\n");

    await writeFile(gitignorePath, newContent);
  }
}
