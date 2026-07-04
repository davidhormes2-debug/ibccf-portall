#!/usr/bin/env bash
# check-chromium.sh — pretest:e2e guard for Playwright's Chromium dependency.
#
# Behaviour:
#   CI=true  → delegate to `npx playwright install chromium` so the managed
#               browser is present before the test run.
#   otherwise → resolve the system Chromium via find-nix-chromium.sh and
#               print the resolved path, or exit 1 with an actionable message
#               when nothing can be found.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── CI path ────────────────────────────────────────────────────────────────
if [[ "${CI:-}" == "true" ]]; then
  echo "CI detected — installing Playwright-managed Chromium..."
  exec npx playwright install chromium
fi

# ── Non-CI path ────────────────────────────────────────────────────────────
# Try explicit override first (mirrors playwright.config.ts resolution order).
if [[ -n "${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}" ]]; then
  if [[ -x "${PLAYWRIGHT_CHROMIUM_EXECUTABLE}" ]]; then
    echo "Playwright will use Chromium at: ${PLAYWRIGHT_CHROMIUM_EXECUTABLE}  (PLAYWRIGHT_CHROMIUM_EXECUTABLE)"
    exit 0
  else
    echo "ERROR: PLAYWRIGHT_CHROMIUM_EXECUTABLE is set but the file is not executable:" >&2
    echo "  ${PLAYWRIGHT_CHROMIUM_EXECUTABLE}" >&2
    exit 1
  fi
fi

# Delegate to the Nix/Replit helper.
CHROMIUM="$("${SCRIPT_DIR}/find-nix-chromium.sh" 2>/dev/null || true)"

if [[ -z "${CHROMIUM}" ]]; then
  echo "" >&2
  echo "ERROR: No Chromium binary found for Playwright." >&2
  echo "" >&2
  echo "  On Replit:" >&2
  echo "    • Ensure 'playwright-browsers' (or 'ungoogled-chromium') is listed in" >&2
  echo "      replit.nix so Replit sets REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE" >&2
  echo "      automatically." >&2
  echo "    • If the package is present but the env var is missing, open a new" >&2
  echo "      shell session (env vars are injected at shell start)." >&2
  echo "" >&2
  echo "  Anywhere else:" >&2
  echo "    • Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to the path of a Chromium binary." >&2
  echo "    • Or add 'chromium' to PATH." >&2
  echo "" >&2
  exit 1
fi

echo "Playwright will use Chromium at: ${CHROMIUM}"
