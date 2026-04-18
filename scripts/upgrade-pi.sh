#!/usr/bin/env bash
set -Eeuo pipefail

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'
  RED=$'\033[31m'
  GREEN=$'\033[32m'
  BLUE=$'\033[34m'
  RESET=$'\033[0m'
else
  BOLD=""
  RED=""
  GREEN=""
  BLUE=""
  RESET=""
fi

info() { printf '\n%s▶%s %s%s%s\n' "$BLUE" "$RESET" "$BOLD" "$*" "$RESET"; }
ok() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
die() { printf '  %s✗ ERROR:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

command -v mise >/dev/null 2>&1 || die "mise is not installed. Install it from https://mise.jdx.dev/."

cd "$REPO_DIR"
[ -f package.json ] || die "Missing package.json in $REPO_DIR"

info "Ensuring mise tools are installed"
mise install

info "Upgrading @mariozechner/pi-coding-agent to latest"
mise exec -- npm install @mariozechner/pi-coding-agent@latest

info "Installed pi version"
version="$(mise exec -- node -e 'const pkg = require("./node_modules/@mariozechner/pi-coding-agent/package.json"); console.log(pkg.version)')"
ok "@mariozechner/pi-coding-agent $version"

ok "Done"
