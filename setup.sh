#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "Setting up pi config in $ROOT_DIR"

if command -v mise >/dev/null 2>&1 && [[ -f mise.toml ]]; then
  echo "Installing tool versions with mise..."
  mise install
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not installed. Install Node.js 24, then rerun setup.sh." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" != "24" ]]; then
  echo "Error: Node.js 24 is required, found $(node --version)." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed." >&2
  exit 1
fi

echo "Installing npm dependencies..."
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

echo "Building generated assets..."
npm run build

echo "Running checks..."
npm run typecheck
npm run lint

echo "Setup complete. Restart pi or run /reload inside pi to load changes."
