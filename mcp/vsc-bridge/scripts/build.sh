#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Installing dependencies ==="
cd "$ROOT_DIR"
npm install

echo ""
echo "=== Building MCP Server ==="
cd "$ROOT_DIR/packages/mcp-server"
npx tsc -p tsconfig.json --outDir dist

echo ""
echo "=== Building VS Code Extension ==="
cd "$ROOT_DIR/packages/vscode-extension"
npx tsc -p tsconfig.json --outDir dist

echo ""
echo "=== Build complete ==="
echo "  - MCP Server: packages/mcp-server/dist/"
echo "  - VS Code Extension: packages/vscode-extension/dist/"
