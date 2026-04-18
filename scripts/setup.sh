#!/usr/bin/env bash
set -Eeuo pipefail

[ "${DEBUG:-}" = "1" ] && set -x

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  RED=$'\033[31m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  BLUE=$'\033[34m'
  RESET=$'\033[0m'
else
  BOLD=""
  DIM=""
  RED=""
  GREEN=""
  YELLOW=""
  BLUE=""
  RESET=""
fi

info() { printf '\n%s▶%s %s%s%s\n' "$BLUE" "$RESET" "$BOLD" "$*" "$RESET"; }
ok() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s⚠ WARNING:%s %s\n' "$YELLOW" "$RESET" "$*" >&2; warnings=$((warnings + 1)); }
die() { printf '  %s✗ ERROR:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: scripts/setup.sh [--check]

Without arguments, installs repo dependencies and configures ~/.local/bin/pi.
With --check, verifies setup health without modifying files.

Set DEBUG=1 to print commands while the script runs.
EOF
}

MODE="setup"
case "${1:-}" in
  "") ;;
  --check) MODE="check" ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
LOCAL_BIN="$HOME/.local/bin"
PI_BIN="$LOCAL_BIN/pi"
warnings=0
errors=0

record_error() {
  printf '  %s✗ ERROR:%s %s\n' "$RED" "$RESET" "$*" >&2
  errors=$((errors + 1))
}

require_file() {
  local path="$1"
  if [ -f "$path" ]; then
    ok "Found ${path#$REPO_DIR/}"
  elif [ "$MODE" = "check" ]; then
    record_error "Missing required file: $path"
  else
    die "Missing required file: $path"
  fi
}

run_required() {
  local description="$1"
  shift
  info "$description"
  if ! "$@"; then
    die "$description failed"
  fi
}

print_version() {
  local name="$1"
  shift
  if command -v "$1" >/dev/null 2>&1; then
    printf '  %s%-8s%s ' "$BOLD" "$name:" "$RESET"
    "$@" 2>/dev/null | head -n 1 || true
  fi
}

expected_pi_launcher() {
  local quoted_repo_dir
  quoted_repo_dir="$(printf '%q' "$REPO_DIR")"
  cat <<EOF
#!/usr/bin/env bash
set -euo pipefail

repo_dir=$quoted_repo_dir
export PI_CODING_AGENT_DIR="\$repo_dir/agent"

cwd=\$PWD

exec mise exec --cd "\$repo_dir" -- bash -c '
  cwd=\$1
  pi_bin=\$2
  shift 2
  cd "\$cwd"
  exec "\$pi_bin" "\$@"
' bash "\$cwd" "\$repo_dir/node_modules/.bin/pi" "\$@"
EOF
}

launcher_points_here() {
  local content="$1"
  local expected
  expected="$(expected_pi_launcher)"

  [ "$content" = "$expected" ] && return 0

  return 1
}

check_repo_root() {
  info "Checking repository files"
  require_file "$REPO_DIR/package.json"
  require_file "$REPO_DIR/package-lock.json"
  require_file "$REPO_DIR/mise.toml"
}

check_mise() {
  info "Checking for mise"
  if command -v mise >/dev/null 2>&1; then
    ok "mise is installed ($(mise --version 2>/dev/null | head -n 1))"
  elif [ "$MODE" = "check" ]; then
    record_error "mise is not installed. Install it from https://mise.jdx.dev/."
  else
    die "mise is not installed. Install it from https://mise.jdx.dev/ and re-run this script."
  fi
}

check_mise_tools() {
  info "Checking mise tools"
  cd "$REPO_DIR"
  if [ "$MODE" = "setup" ]; then
    run_required "Installing mise tools" mise install
    return
  fi

  local missing
  missing="$(mise ls --current --missing --no-header 2>/dev/null || true)"
  if [ -n "$missing" ]; then
    record_error "mise tools are missing. Run: mise install"
    printf '  %s%s%s\n' "$DIM" "$missing" "$RESET" >&2
  else
    ok "mise tools are satisfied"
  fi
}

install_node_dependencies() {
  cd "$REPO_DIR"
  if [ "$MODE" = "check" ]; then
    info "Checking npm dependencies"
    if [ -x "$REPO_DIR/node_modules/.bin/pi" ]; then
      ok "npm dependencies are installed"
    else
      record_error "npm dependencies are missing. Run: scripts/setup.sh"
    fi
    return
  fi

  if [ -f "$REPO_DIR/package-lock.json" ]; then
    run_required "Running npm ci" mise exec -- npm ci
  else
    run_required "Running npm install" mise exec -- npm install
  fi
}

setup_pi_launcher() {
  local expected
  expected="$(expected_pi_launcher)"

  if [ "$MODE" = "check" ]; then
    info "Checking $PI_BIN"
    if [ ! -x "$PI_BIN" ]; then
      record_error "$PI_BIN is missing or not executable. Run: scripts/setup.sh"
    elif ! launcher_points_here "$(cat "$PI_BIN" 2>/dev/null)"; then
      record_error "$PI_BIN does not point at this repository. Run: scripts/setup.sh"
    else
      ok "$PI_BIN is configured"
    fi
    return
  fi

  info "Setting up $PI_BIN"
  mkdir -p "$LOCAL_BIN"
  if [ -e "$PI_BIN" ] || [ -L "$PI_BIN" ]; then
    if [ "$(cat "$PI_BIN" 2>/dev/null || true)" != "$expected" ]; then
      warn "$PI_BIN already exists and will be overwritten to point at $REPO_DIR."
    fi
  fi
  printf '%s\n' "$expected" > "$PI_BIN"
  chmod +x "$PI_BIN"
}

check_pi_works() {
  info "Checking pi executable"
  if [ ! -x "$REPO_DIR/node_modules/.bin/pi" ]; then
    if [ "$MODE" = "check" ]; then
      record_error "Expected pi executable at $REPO_DIR/node_modules/.bin/pi"
      return
    fi
    die "Expected pi executable at $REPO_DIR/node_modules/.bin/pi after dependency install."
  fi

  if "$PI_BIN" --help >/dev/null 2>&1; then
    ok "pi launcher runs"
  elif [ "$MODE" = "check" ]; then
    record_error "pi launcher failed: $PI_BIN --help"
  else
    die "pi launcher failed: $PI_BIN --help"
  fi
}


check_helper_tools() {
  info "Checking optional helper tools"
  if command -v uv >/dev/null 2>&1; then
    ok "uv is installed ($(uv --version 2>/dev/null | head -n 1))"
  else
    warn "uv is not installed. Install it if you use Python-based helpers."
  fi

  if command -v jq >/dev/null 2>&1; then
    ok "jq is installed ($(uv --version 2>/dev/null | head -n 1))"
  else
    warn "jq is not installed. Install it to interact with json files."
  fi

  if command -v tmux >/dev/null 2>&1; then
    ok "tmux is installed ($(tmux -V 2>/dev/null | head -n 1))"
  else
    warn "tmux is not installed. Install it if you use workflows that depend on tmux."
  fi

  if command -v gh >/dev/null 2>&1; then
    ok "gh is installed ($(gh --version 2>/dev/null | head -n 1))"
    if gh auth status >/dev/null 2>&1; then
      ok "gh auth is configured"
    else
      warn "gh is installed but not authenticated. Run 'gh auth login' if you use /review pr."
    fi
  else
    warn "gh is not installed. Install GitHub CLI if you use /review pr."
  fi

  if [ -n "${PERPLEXITY_API_KEY:-}" ]; then
    ok "PERPLEXITY_API_KEY is set"
  else
    warn "PERPLEXITY_API_KEY is not set. Add it to your shell profile if you use Perplexity-backed tools."
  fi

  case ":$PATH:" in
    *":$LOCAL_BIN:"*) ok "$LOCAL_BIN is in PATH" ;;
    *) warn "$LOCAL_BIN is not in PATH. Add it to your shell profile to run 'pi' directly." ;;
  esac
}

run_mise_doctor() {
  info "Running mise doctor"
  if command -v mise >/dev/null 2>&1; then
    if mise doctor >/dev/null 2>&1; then
      ok "mise doctor passed"
    else
      warn "mise doctor reported issues. Run 'mise doctor' for details."
    fi
  fi
}

print_summary() {
  info "Tool versions"
  print_version "mise" mise --version
  if command -v mise >/dev/null 2>&1; then
    local node_version npm_version
    node_version="$(cd "$REPO_DIR" && mise exec -- node --version 2>/dev/null | head -n 1)" || node_version=""
    npm_version="$(cd "$REPO_DIR" && mise exec -- npm --version 2>/dev/null | head -n 1)" || npm_version=""
    [ -n "$node_version" ] && printf '  %s%-8s%s %s\n' "$BOLD" "node:" "$RESET" "$node_version"
    [ -n "$npm_version" ] && printf '  %s%-8s%s %s\n' "$BOLD" "npm:" "$RESET" "$npm_version"
  fi

  info "Summary"
  printf '  %s%-12s%s %s\n' "$BOLD" "Mode:" "$RESET" "$MODE"
  printf '  %s%-12s%s %s\n' "$BOLD" "Repository:" "$RESET" "$REPO_DIR"
  printf '  %s%-12s%s %s\n' "$BOLD" "pi launcher:" "$RESET" "$PI_BIN"
  printf '  %s%-12s%s %s\n' "$BOLD" "Warnings:" "$RESET" "$warnings"
  printf '  %s%-12s%s %s\n' "$BOLD" "Errors:" "$RESET" "$errors"
}

main() {
  check_repo_root
  check_mise
  check_mise_tools
  install_node_dependencies
  setup_pi_launcher
  check_pi_works
  check_helper_tools
  run_mise_doctor
  print_summary

  if [ "$errors" -gt 0 ]; then
    exit 1
  fi

  if [ "$warnings" -gt 0 ]; then
    info "Completed with warnings."
  else
    info "Completed successfully."
  fi
}

main
