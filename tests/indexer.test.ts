import { describe, it, expect } from "vitest";
import { buildIndex } from "../src/indexer.js";

const warning =
  "STOP. What you remember about hello-world may be WRONG for this project. Always search docs and read before any task.";

describe("buildIndex", () => {
  it("should generate correct AGENTS.md format for single file", () => {
    const tree = new Map<string, string[]>([["", ["README.md"]]]);

    const result = buildIndex(tree, "hello-world", "documentation/hello-world");

    expect(result).toBe(
      "<!-- HELLO-WORLD-AGENTS-MD-START -->" +
        "[hello-world Docs Index]|" +
        "root: documentation/hello-world|" +
        `${warning}|` +
        "(root):{README.md}" +
        "<!-- HELLO-WORLD-AGENTS-MD-END -->"
    );
  });

  it("should include multiple directories in sorted order", () => {
    const tree = new Map<string, string[]>([
      ["guides", ["setup.md", "intro.md"]],
      ["", ["README.md"]],
      ["api", ["reference.md"]],
    ]);

    const result = buildIndex(tree, "mylib", "docs/mylib");

    expect(result).toContain("(root):{README.md}");
    expect(result).toContain("api:{reference.md}");
    expect(result).toContain("guides:{intro.md,setup.md}");

    const rootIndex = result.indexOf("(root)");
    const apiIndex = result.indexOf("api:");
    const guidesIndex = result.indexOf("guides:");

    expect(rootIndex).toBeLessThan(apiIndex);
    expect(apiIndex).toBeLessThan(guidesIndex);
  });

  it("should uppercase repo name in markers", () => {
    const tree = new Map<string, string[]>([["", ["doc.md"]]]);

    const result = buildIndex(tree, "my-lib", "docs/my-lib");

    expect(result).toContain("<!-- MY-LIB-AGENTS-MD-START -->");
    expect(result).toContain("<!-- MY-LIB-AGENTS-MD-END -->");
  });

  it("should handle empty tree", () => {
    const tree = new Map<string, string[]>();

    const result = buildIndex(tree, "empty", "docs/empty");

    expect(result).toContain("<!-- EMPTY-AGENTS-MD-START -->");
    expect(result).toContain("<!-- EMPTY-AGENTS-MD-END -->");
    expect(result).toContain("[empty Docs Index]");
  });

  it("should escape delimiters in directories and filenames", () => {
    const tree = new Map<string, string[]>([
      ["api|v1", ["guide,one.md", "ref{1}.md", "path:2.md", "back\\slash.md"]],
      ["", ["README.md"]],
    ]);

    const result = buildIndex(tree, "mylib", "docs/mylib");

    expect(result).toContain("api\\|v1:{");
    expect(result).toContain("guide\\,one.md");
    expect(result).toContain("ref\\{1\\}.md");
    expect(result).toContain("path\\:2.md");
    expect(result).toContain("back\\\\slash.md");
  });
});
