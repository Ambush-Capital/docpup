# docpup

CLI tool to clone GitHub documentation and generate AGENTS.md indexes for AI coding agents.

## What it does

Docpup fetches documentation from GitHub repositories using sparse checkout, copies only markdown files (`.md` and `.mdx`) to a local directory, and generates compact index files in the AGENTS.md format. These indexes provide persistent context to AI coding agents.

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
  - name: nextjs
    repo: https://github.com/vercel/next.js
    sourcePath: docs
    ref: canary

  - name: auth0-docs
    repo: https://github.com/auth0/docs-v2
    sourcePath: main/docs
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `docsDir` | string | `"documentation"` | Output directory for copied docs |
| `indicesDir` | string | `"documentation/indices"` | Output directory for index files |
| `gitignore.addDocsDir` | boolean | `true` | Add docs directories to .gitignore |
| `gitignore.addIndexFiles` | boolean | `false` | Add index files to .gitignore |
| `gitignore.sectionHeader` | string | `"Docpup generated docs"` | Header for .gitignore section |
| `scan.includeMd` | boolean | `true` | Include .md files |
| `scan.includeMdx` | boolean | `true` | Include .mdx files |
| `scan.includeHiddenDirs` | boolean | `false` | Scan hidden directories (dotfolders) |
| `scan.excludeDirs` | string[] | `[...]` | Directories to exclude |
| `concurrency` | number | `2` | Number of repos to process in parallel |

### Repo Configuration

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | string | Yes | Unique identifier for this repo |
| `repo` | string | Yes | GitHub repository URL |
| `sourcePath` | string | Yes | Path to docs directory within the repo (use `.` for root) |
| `ref` | string | No | Branch, tag, or commit (auto-detects default branch if not specified) |
| `preprocess` | object | No | Optional preprocess step (currently only Sphinx) |
| `scan` | object | No | Per-repo scan overrides (merged with global scan config) |

### Preprocess 

Note that `preprocess` only supports Sphinx for now, but is extensible to utilize any required preprocessor.

The Spinx preprocessor uses ([Sphinx](https://github.com/sphinx-doc/sphinx)) to build docs before scanning. 
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

Notes:
- `sourcePath` must exist in the repo (used for sparse checkout).
- `builder` must be `markdown` (requires `sphinx-markdown-builder`).
- `outputDir` must be a non-hidden directory unless `scan.includeHiddenDirs` is true.

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

```
<!-- NEXTJS-AGENTS-MD-START -->[nextjs Docs Index]|root: documentation/nextjs|STOP. What you remember about nextjs may be WRONG for this project. Always search docs and read before any task.|(root):{index.mdx}|guides:{setup.md,intro.md}<!-- NEXTJS-AGENTS-MD-END -->
```

This compact format provides:
- Start/end markers for easy parsing
- Root path for the documentation
- Warning to always check docs before making assumptions
- Directory-to-file mapping for quick lookup

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
