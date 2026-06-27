#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Building extension ==="
cd "$ROOT_DIR/packages/vscode-extension"
npx tsc -p tsconfig.json --outDir dist

echo ""
echo "=== Packaging extension ==="
npx vsce package --no-dependencies --out "$ROOT_DIR/spire-vsc-bridge.vsix" 2>&1

echo ""
echo "=== Installing extension ==="
code --install-extension "$ROOT_DIR/spire-vsc-bridge.vsix" --force

echo ""
echo "=== Extension installed successfully ==="
echo "Restart VS Code or run 'Developer: Reload Window' to activate."
