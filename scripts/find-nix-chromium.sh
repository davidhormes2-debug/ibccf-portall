#!/usr/bin/env bash
# find-nix-chromium.sh — Resolve the current Playwright-compatible Chromium
# binary for Replit and other Nix-based environments.
#
# Resolution order (fast — no filesystem scanning):
#   1. REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE env var (set automatically by
#      Replit; survives runtime upgrades because Replit updates it when the
#      browsers package hash changes).
#   2. `which chromium` (works when ungoogled-chromium is on $PATH).
#   3. PLAYWRIGHT_CHROMIUM_EXECUTABLE env var (explicit user override).
#
# Exits 0 and prints the resolved path on success.
# Exits 1 with a message on stderr when nothing is found.

set -euo pipefail

# 1. Replit-managed Playwright browsers path (most reliable on Replit)
if [[ -n "${REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}" && -x "${REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE}" ]]; then
  echo "$REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE"
  exit 0
fi

# 2. chromium on PATH (e.g. ungoogled-chromium added to replit.nix deps)
if command -v chromium &>/dev/null; then
  echo "$(command -v chromium)"
  exit 0
fi

# 3. Explicit env override (also accepted by playwright.config.ts, but handle
#    it here so the script is usable standalone)
if [[ -n "${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}" && -x "${PLAYWRIGHT_CHROMIUM_EXECUTABLE}" ]]; then
  echo "$PLAYWRIGHT_CHROMIUM_EXECUTABLE"
  exit 0
fi

echo "find-nix-chromium: could not locate a Chromium binary. Set REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE or add chromium to PATH." >&2
exit 1
