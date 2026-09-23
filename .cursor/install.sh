#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for Zotero ChatGPT.
# Prepares the pinned Node 24 toolchain, installs dependencies from the committed
# lockfile, and fetches the SHA-256-verified bundled Codex runtime so the packaging
# and verification commands documented in docs/development.md work out of the box.
set -euo pipefail

cd "$(dirname "$0")/.."

# The repo pins Node via .nvmrc (24.11.0) and requires engines ">=24 <25". The base
# image defaults to Node 22, so select the pinned version through nvm and make it the
# default for every future shell/terminal in this environment.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

NODE_VERSION="$(tr -d '[:space:]' < .nvmrc)"
nvm install "$NODE_VERSION"
nvm alias default "$NODE_VERSION"
nvm use "$NODE_VERSION"

echo "Using Node $(node --version) / npm $(npm --version)"

# Interactive/login shells and tmux terminals pick up Node 24 via the nvm default
# alias above. The non-interactive per-command executor, however, prepends
# /exec-daemon (which bundles its own Node 22) to PATH, shadowing nvm's Node for
# bare `node` lookups; that breaks tests/tools that spawn child `node` processes.
# /usr/local/cargo/bin sits ahead of /exec-daemon on that PATH and is on the real
# disk, so linking the pinned Node/npm/npx there makes every execution context
# resolve Node 24. Best-effort and idempotent: skip silently if the dir is absent.
NODE_BIN_DIR="$(dirname "$(nvm which "$NODE_VERSION")")"
PREFERRED_BIN_DIR="/usr/local/cargo/bin"
if [ -d "$PREFERRED_BIN_DIR" ] && [ -w "$PREFERRED_BIN_DIR" ]; then
  for tool in node npm npx; do
    ln -sfn "$NODE_BIN_DIR/$tool" "$PREFERRED_BIN_DIR/$tool"
  done
  echo "Linked Node $NODE_VERSION into $PREFERRED_BIN_DIR for the command executor."
fi

# Deterministic dependency install from package-lock.json.
npm ci

# Fetch + verify the pinned Codex 0.156.1 archive into the ignored .zotero-chatgpt-dev/runtime-cache/.
# This is idempotent: it skips the download when the archive is already present and its
# SHA-256 matches runtime/manifest.ts. Required by `npm run package:dev`.
node scripts/runtime-prepare.mjs

echo "Zotero ChatGPT environment ready."
