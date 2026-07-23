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
#   ./run.sh dev        # Phase 2: the web app, Vite dev server on :5173
#   ./run.sh build      # Phase 2: static production build of the web app
#
# S5 (Stabilize) removed the app commands because they dispatched to `@isomat/web`
# and `@isomat/planner`, neither of which existed. `@isomat/web` exists again as of
# Phase 2 / W0, so `dev` and `build` are back — and only those two. Generation and
# the browser gate (verify, record, gate) stay deleted.
#
# The cheap tier is still the loop: `test` + `typecheck` prove everything, and the
# web app is testable headless. `dev` is for looking at it, not for gating it.
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
  dev)
    # The client-only web app (Phase 2 decision #6). No server, no API key.
    exec pnpm --filter @isomat/web dev "$@"
    ;;
  build)
    # Static output in packages/web/dist — deployable to any static host.
    exec pnpm --filter @isomat/web build "$@"
    ;;
  *)
    echo "usage: ./run.sh [test|typecheck|install|dev|build]" >&2
    exit 2
    ;;
esac
