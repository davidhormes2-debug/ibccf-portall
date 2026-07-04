#!/usr/bin/env bash
# Wraps a real Chromium binary with `nice` so headless Chromium gets a lower
# CPU scheduling priority than the app's dev server / Postgres during local
# (non-CI) Playwright runs.
#
# Why: in the Replit dev sandbox (2 vCPUs), a real headless Chromium instance
# competes for CPU with the Vite/tsx dev server and the local Postgres
# instance. Under that contention, individual admin-dashboard requests (most
# often `GET /api/cases`) have been observed to stall 70-100+ seconds even
# though the underlying query takes well under a second in isolation — see
# `.agents/memory/local-devdb-case-volume.md`. Chromium's rendering speed
# doesn't matter for a headless test; the app server's responsiveness does.
# Niceing Chromium down (positive nice value = lower priority) gives the
# kernel scheduler a hint to prefer the dev server / Postgres when both are
# runnable, reducing (not eliminating) that stall.
#
# Usage: set as the Playwright `executablePath`, with $REAL_CHROMIUM_BIN
# pointing at the actual binary. Never used in CI (CI has no such
# contention and uses Playwright's own managed browser install).
set -euo pipefail

REAL="${REAL_CHROMIUM_BIN:-}"
if [ -z "$REAL" ]; then
  echo "niced-chromium.sh: REAL_CHROMIUM_BIN is not set" >&2
  exit 1
fi

exec nice -n 10 "$REAL" "$@"
