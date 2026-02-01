import { describe, it, expect } from "vitest";
import { buildIndex } from "../src/indexer.js";
import type { DocTree } from "../src/types.js";

describe("buildIndex", () => {
  it("should generate correct AGENTS.md format for single file", () => {
    const tree: DocTree = new Map([["(root)", ["README.md"]]]);

    const result = buildIndex(tree, "hello-world", "documentation/hello-world");

    expect(result).toBe(
      "<!-- HELLO-WORLD-AGENTS-MD-START -->" +
        "[hello-world Docs Index]|" +
        "root: documentation/hello-world|" +
        "STOP. What you remember about hello-world may be WRONG for this project. Always search docs and read before any task.|" +
        "((root)):{README.md}" +
        "<!-- HELLO-WORLD-AGENTS-MD-END -->"
    );
  });

  it("should include multiple directories in sorted order", () => {
    const tree: DocTree = new Map([
      ["guides", ["setup.md", "intro.md"]],
      ["(root)", ["README.md"]],
      ["api", ["reference.md"]],
    ]);

    const result = buildIndex(tree, "mylib", "docs/mylib");

    expect(result).toContain("((root)):{README.md}");
    expect(result).toContain("(api):{reference.md}");
    expect(result).toContain("(guides):{intro.md,setup.md}");

    const rootIndex = result.indexOf("((root))");
    const apiIndex = result.indexOf("(api)");
    const guidesIndex = result.indexOf("(guides)");

    expect(rootIndex).toBeLessThan(apiIndex);
    expect(apiIndex).toBeLessThan(guidesIndex);
  });

  it("should uppercase repo name in markers", () => {
    const tree: DocTree = new Map([["(root)", ["doc.md"]]]);

    const result = buildIndex(tree, "my-lib", "docs/my-lib");

    expect(result).toContain("<!-- MY-LIB-AGENTS-MD-START -->");
    expect(result).toContain("<!-- MY-LIB-AGENTS-MD-END -->");
  });

  it("should handle empty tree", () => {
    const tree: DocTree = new Map();

    const result = buildIndex(tree, "empty", "docs/empty");

    expect(result).toContain("<!-- EMPTY-AGENTS-MD-START -->");
    expect(result).toContain("<!-- EMPTY-AGENTS-MD-END -->");
    expect(result).toContain("[empty Docs Index]");
  });
});
