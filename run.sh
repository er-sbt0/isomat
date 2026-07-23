#!/usr/bin/env bash
#
# run.sh — convenience runner for the isomat monorepo.
#
# Node/pnpm live under nvm and aren't on PATH by default, so this script wires
# them up first, then dispatches a subcommand.
#
# Usage:
#   ./run.sh test       # one vitest across all package projects (~2s — the loop)
#   ./run.sh typecheck  # strict tsc --noEmit across packages, in parallel
#   ./run.sh install    # install workspace dependencies
#
# The app / generation / browser-gate commands (dev, build, verify, record, …)
# were removed in the Stabilize milestone (S5): they dispatched to `@isomat/web`
# and `@isomat/planner`, which do not exist in this repo. The loop is the two
# free tiers above.
#
set -euo pipefail

cd "$(dirname "$0")"

# --- make node/pnpm available (nvm-managed, not on PATH) ---
if ! command -v pnpm >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
    nvm use default >/dev/null 2>&1 || nvm use node >/dev/null 2>&1 || true
  fi
  # Fall back to the known install location if nvm didn't put node on PATH.
  for bin in "$NVM_DIR"/versions/node/*/bin; do
    [ -x "$bin/node" ] && export PATH="$bin:$PATH"
  done
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@9 --activate >/dev/null 2>&1 || true
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: could not find pnpm (looked under \$NVM_DIR=$NVM_DIR)." >&2
  echo "       install Node via nvm, then: corepack enable" >&2
  exit 1
fi

echo "• node $(node --version)  pnpm $(pnpm --version)"

# --- install deps on first run ---
if [ ! -d node_modules ]; then
  echo "• installing dependencies…"
  pnpm install
fi

cmd="${1:-test}"
shift || true

case "$cmd" in
  test)
    # One vitest across all package projects (see vitest.workspace.ts), not a
    # cold start per package. Per-package `pnpm --filter <pkg> test` still works.
    exec pnpm exec vitest run "$@"
    ;;
  typecheck)
    # --parallel, not topological: every package typechecks its own SOURCES and
    # consumes no other package's build output, so the ordering `pnpm -r` pays
    # for buys nothing. A failure in any package still exits non-zero and still
    # names the package.
    exec pnpm -r --parallel typecheck
    ;;
  install)
    exec pnpm install
    ;;
  *)
    echo "usage: ./run.sh [test|typecheck|install]" >&2
    exit 2
    ;;
esac
