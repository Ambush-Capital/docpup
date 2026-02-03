# Docpup justfile

# Default recipe
default:
    @just --list

# Run tests
test:
    npm test

# Build the project
build:
    npm run build

# Install dependencies
install:
    npm install

# Increment minor version, build, and publish to npm
release:
    #!/usr/bin/env bash
    set -euo pipefail

    echo "📦 Installing dependencies..."
    npm install

    echo "🔨 Building..."
    npm run build

    echo "🧪 Running tests..."
    npm test

    echo "📝 Incrementing minor version..."
    npm version minor --no-git-tag-version

    NEW_VERSION=$(node -p "require('./package.json').version")
    echo "New version: $NEW_VERSION"

    echo "🔐 Logging in to npm..."
    npm login

    echo "🚀 Publishing to npm..."
    npm publish --access public

    echo "✅ Published docpup@$NEW_VERSION"

# Increment patch version and publish
release-patch:
    #!/usr/bin/env bash
    set -euo pipefail

    echo "📦 Installing dependencies..."
    npm install

    echo "🔨 Building..."
    npm run build

    echo "🧪 Running tests..."
    npm test

    echo "📝 Incrementing patch version..."
    npm version patch --no-git-tag-version

    NEW_VERSION=$(node -p "require('./package.json').version")
    echo "New version: $NEW_VERSION"

    echo "🔐 Logging in to npm..."
    npm login

    echo "🚀 Publishing to npm..."
    npm publish --access public

    echo "✅ Published docpup@$NEW_VERSION"
