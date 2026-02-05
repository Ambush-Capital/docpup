# docpup

CLI tool to clone GitHub documentation and source code, generating AGENTS.md indexes for AI coding agents.

## What it does

Docpup fetches documentation or source code from GitHub repositories using sparse checkout, copies files to a local directory, and generates compact index files in the AGENTS.md format. These indexes provide persistent context to AI coding agents.

Supports:
- Documentation files (`.md`, `.mdx`)
- Source code with custom extensions (`.ts`, `.js`, `.py`, etc.)
- Selective directory fetching (e.g., only `src` and `samples`)
- Single file fetching (e.g., just `README.md`)

Paths in the config are resolved from the current working directory where you run the CLI.

## Installation

```bash
npm install -g docpup
```

Or run directly with npx:

```bash
npx docpup generate
```

## Quick Start

1. Create a `docpup.config.yaml` in your project root:

```yaml
docsDir: documentation
indicesDir: documentation/indices
repos:
  - name: nextjs
    repo: https://github.com/vercel/next.js
    sourcePath: docs
    ref: canary
```

2. Run docpup:

```bash
docpup generate
```

3. Find your docs in `documentation/nextjs/` and the index in `documentation/indices/nextjs-index.md`.

## Configuration

### Full Configuration Example

```yaml
docsDir: documentation
indicesDir: documentation/indices

gitignore:
  addDocsDir: true
  addDocsSubDirs: false
  addIndexFiles: false
  sectionHeader: "Docpup generated docs"

scan:
  includeMd: true
  includeMdx: true
  includeHiddenDirs: false
  excludeDirs:
    - .git
    - node_modules
    - images
    - assets

concurrency: 2

repos:
  # Traditional documentation indexing
  - name: nextjs
    repo: https://github.com/vercel/next.js
    sourcePath: docs
    ref: canary

  - name: auth0-docs
    repo: https://github.com/auth0/docs-v2
    sourcePath: main/docs

  # Source code indexing with multiple directories
  - name: codex-sdk
    repo: https://github.com/openai/codex
    contentType: source
    sourcePaths:
      - sdk/typescript/src
      - sdk/typescript/samples
    scan:
      extensions: [".ts", ".tsx"]

  # Single file indexing
  - name: codex-readme
    repo: https://github.com/openai/codex
    sourcePaths:
      - sdk/typescript/README.md
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `docsDir` | string | `"documentation"` | Output directory for copied docs |
| `indicesDir` | string | `"documentation/indices"` | Output directory for index files |
| `gitignore.addDocsDir` | boolean | `true` | Add docs directory to .gitignore |
| `gitignore.addDocsSubDirs` | boolean | `false` | Add per-repo subdirectories to .gitignore (e.g., `docs/nextjs/`) instead of whole docs dir |
| `gitignore.addIndexFiles` | boolean | `false` | Add indices directory to .gitignore |
| `gitignore.sectionHeader` | string | `"Docpup generated docs"` | Header for .gitignore section |
| `scan.includeMd` | boolean | `true` | Include .md files (ignored if `extensions` is set) |
| `scan.includeMdx` | boolean | `true` | Include .mdx files (ignored if `extensions` is set) |
| `scan.includeHiddenDirs` | boolean | `false` | Scan hidden directories (dotfolders) |
| `scan.excludeDirs` | string[] | `[...]` | Directories to exclude |
| `scan.extensions` | string[] | - | Custom file extensions to include (e.g., `[".ts", ".js"]`). Overrides `includeMd`/`includeMdx` |
| `concurrency` | number | `2` | Number of repos to process in parallel |

### Repo Configuration

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | string | Yes | Unique identifier for this repo |
| `repo` | string | Yes | GitHub repository URL |
| `sourcePath` | string | One of `sourcePath` or `sourcePaths` | Single path to fetch (use `.` for root) |
| `sourcePaths` | string[] | One of `sourcePath` or `sourcePaths` | Multiple paths to fetch (directories or single files) |
| `ref` | string | No | Branch, tag, or commit (auto-detects default branch if not specified) |
| `contentType` | string | No | `"docs"` (default) or `"source"` - affects index title and warning message |
| `preprocess` | object | No | Optional preprocess step (currently only Sphinx, single path only) |
| `scan` | object | No | Per-repo scan overrides (merged with global scan config) |

### Preprocess

Note that `preprocess` supports Sphinx and HTML today, but is extensible to utilize any required preprocessor.

The Sphinx preprocessor uses ([Sphinx](https://github.com/sphinx-doc/sphinx)) to build docs before scanning.
This is useful for projects like Django that rely on reStructuredText includes, substitutions, and directives.

```yaml
repos:
  - name: django-docs
    repo: https://github.com/django/django
    sourcePath: docs
    preprocess:
      type: sphinx
      workDir: docs
      builder: markdown
      outputDir: docpup-build
```

Prerequisites:
- Python 3 on PATH (`python`)
- Sphinx + Markdown builder: `python -m pip install sphinx sphinx-markdown-builder`

Notes:
- `sourcePath` (or a single entry in `sourcePaths`) must exist in the repo (used for sparse checkout).
- If `workDir` is omitted, it defaults to `sourcePath` or the single `sourcePaths` entry.
- `builder` must be `markdown` (requires `sphinx-markdown-builder`).
- `outputDir` must be a non-hidden directory unless `scan.includeHiddenDirs` is true.
- Preprocess is not supported with multiple `sourcePaths`.

### HTML Preprocess

The HTML preprocessor converts HTML pages into Markdown before scanning and indexing.

```yaml
repos:
  - name: python-genai
    repo: https://github.com/googleapis/python-genai
    sourcePath: docs
    preprocess:
      type: html
      workDir: docs
      outputDir: docpup-build
      rewriteLinks: true
```

Notes:
- `workDir` defaults to `sourcePath`.
- `rewriteLinks` defaults to `true`, converting `.html`/`.htm` links to `.md`.
- `selector` can be used to target a specific content node (e.g., `main`, `article`, or `#content`).

### Source Code Indexing

Docpup can index source code in addition to documentation. Use `contentType: source` and custom `extensions` to fetch specific file types:

```yaml
repos:
  - name: my-sdk
    repo: https://github.com/example/sdk
    contentType: source
    sourcePaths:
      - src
      - samples
    scan:
      extensions: [".ts", ".tsx", ".js"]
      excludeDirs: [node_modules, dist, __tests__]
```

This generates an index with a "Source Index" title and appropriate warning:

```
<!-- MY-SDK-AGENTS-MD-START -->[my-sdk Source Index]|root: documentation/my-sdk|STOP. This is source code from my-sdk. Search and read files before making changes.|src:{index.ts,client.ts}|samples:{basic.ts}<!-- MY-SDK-AGENTS-MD-END -->
```

### Single File Fetching

You can fetch individual files by specifying file paths in `sourcePaths`:

```yaml
repos:
  - name: project-readme
    repo: https://github.com/example/project
    sourcePaths:
      - README.md
      - docs/CONTRIBUTING.md
```

## CLI Usage

```bash
# Run with default config
docpup generate

# Specify config file
docpup generate --config ./custom-config.yaml

# Process only specific repos
docpup generate --only nextjs,temporal

# Override concurrency
docpup generate --concurrency 4

# Show help
docpup --help

# Show version
docpup --version
```

## Index File Format

Docpup generates index files in the AGENTS.md format:

**Documentation Index:**
```
<!-- NEXTJS-AGENTS-MD-START -->[nextjs Docs Index]|root: documentation/nextjs|STOP. What you remember about nextjs may be WRONG for this project. Always search docs and read before any task.|(root):{index.mdx}|guides:{setup.md,intro.md}<!-- NEXTJS-AGENTS-MD-END -->
```

**Source Code Index:**
```
<!-- CODEX-SDK-AGENTS-MD-START -->[codex-sdk Source Index]|root: documentation/codex-sdk|STOP. This is source code from codex-sdk. Search and read files before making changes.|sdk/typescript/src:{index.ts,client.ts}|sdk/typescript/samples:{basic.ts}<!-- CODEX-SDK-AGENTS-MD-END -->
```

This compact format provides:
- Start/end markers for easy parsing
- Root path for the files
- Context-aware warning (docs vs source code)
- Directory-to-file mapping with preserved path structure

## Authentication

Docpup uses your existing git credentials (SSH keys, credential helpers, or stored tokens). No additional authentication configuration is required.

For private repositories, ensure you have access configured in your git environment.

## Error Handling

- If a repository fails to clone, docpup logs a warning and continues with other repos
- The CLI always exits with status 0 if it can continue running (non-fatal errors)
- Invalid configuration or unexpected errors result in non-zero exit

## Requirements

- Node.js 20 or later
- Git 2.25 or later (for sparse-checkout support)

## License

MIT
