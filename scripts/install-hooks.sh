#!/usr/bin/env bash
# install-hooks.sh
#
# Called automatically by the `prepare` npm lifecycle script (i.e. after every
# `npm install`).  Copies the tracked .husky/pre-push hook into .git/hooks/ so
# the e2e skip-guard check runs locally before every push.
#
# Safe to run in CI / non-git environments — it exits 0 with a notice when
# .git/hooks/ is absent.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
HOOK_SRC="$REPO_ROOT/.husky/pre-push"
HOOK_DST="$HOOKS_DIR/pre-push"

if [[ ! -d "$HOOKS_DIR" ]]; then
  echo "install-hooks: .git/hooks not found — skipping hook installation (CI or non-git environment)."
  exit 0
fi

if [[ ! -f "$HOOK_SRC" ]]; then
  echo "install-hooks: ERROR — hook source not found: $HOOK_SRC" >&2
  exit 1
fi

cp "$HOOK_SRC" "$HOOK_DST"
chmod +x "$HOOK_DST"
echo "install-hooks: pre-push hook installed at $HOOK_DST"
