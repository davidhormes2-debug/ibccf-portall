#!/usr/bin/env bash
# record-videos.sh — produce one downloadable MP4 per locale of the withdrawal
# tutorial video.
#
# Why a shell wrapper instead of looping inside Node: Chromium's video capture
# (Playwright `recordVideo`) reliably records only the FIRST browser launched in
# a given Node process. A second launch in the same process comes up with a dead
# renderer and the capture freezes a few hundred KB in. Recording one locale per
# fresh Node process sidesteps that entirely — every locale gets a pristine
# browser. See video/scripts/record-videos.mjs for the per-locale recorder.
#
# Usage:
#   bash video/scripts/record-videos.sh              # all six locales
#   bash video/scripts/record-videos.sh en de        # a subset
#   SKIP_BUILD=1 bash video/scripts/record-videos.sh # reuse an existing build
#   WIDTH=1920 HEIGHT=1080 bash video/scripts/record-videos.sh
#
# Output: video/public/recordings/withdrawal-tutorial-<locale>.mp4

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

ALL_LOCALES=(en es fr de pt zh)
if [ "$#" -gt 0 ]; then
  LOCALES=("$@")
else
  LOCALES=("${ALL_LOCALES[@]}")
fi

# Playwright bundles its own ffmpeg for video capture; ensure it is present.
if [ ! -e "${HOME}/.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux" ]; then
  echo "› Installing Playwright's bundled ffmpeg (needed for video capture)…"
  npx playwright install ffmpeg
fi

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "› Building recorder app…"
  npx vite build --config video/vite.config.ts
fi

echo "› Recording locales: ${LOCALES[*]}"
failed=()
for locale in "${LOCALES[@]}"; do
  # Each invocation = a fresh Node process = a fresh, working Chromium capture.
  # Don't let one locale's failure abort the rest of the batch (set -e is off
  # for this call); collect failures and report them at the end.
  if ! node "${SCRIPT_DIR}/record-videos.mjs" --skip-build "${locale}"; then
    echo "  ! ${locale} failed — continuing with the rest." >&2
    failed+=("${locale}")
  fi
done

echo ""
echo "Done. MP4s written to video/public/recordings/"
ls -1 video/public/recordings/*.mp4 2>/dev/null || true

if [ "${#failed[@]}" -gt 0 ]; then
  echo "" >&2
  echo "Failed locales: ${failed[*]} — re-run e.g. 'SKIP_BUILD=1 bash video/scripts/record-videos.sh ${failed[*]}'" >&2
  exit 1
fi
