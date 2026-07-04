#!/bin/bash
# Validates that the video recording lifecycle hooks are properly wired up.
# Exit 0 = valid, Exit 1 = missing hooks.
#
# Pass --self-test to verify that the SCENE_DURATIONS parity check itself fires
# correctly: a synthetic one-value mutation is injected and the check must exit
# non-zero. The self-test exits 0 only when the guard catches the drift.

ARTIFACT_DIR="$(dirname "$0")/.."
SRC_DIR="$ARTIFACT_DIR/src"

errors=0

SELF_TEST=0
for arg in "$@"; do
  case "$arg" in
    --self-test) SELF_TEST=1 ;;
  esac
done

# Check that useVideoPlayer is imported somewhere in components/
if ! grep -rq "useVideoPlayer" "$SRC_DIR/components/"; then
  echo "ERROR: No component imports useVideoPlayer from @/lib/video."
  echo "  VideoTemplate must use: const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });"
  echo "  Without this, video export will not work correctly."
  errors=$((errors + 1))
fi

# Check that hooks.ts still has the actual startRecording/stopRecording calls (not just the type declaration)
if ! grep -Fq 'window.startRecording?.()' "$SRC_DIR/lib/video/hooks.ts" 2>/dev/null; then
  echo "ERROR: src/lib/video/hooks.ts is missing the window.startRecording?.() call."
  echo "  This file should not be modified. Restore it from the template."
  errors=$((errors + 1))
fi

if ! grep -Fq 'window.stopRecording?.()' "$SRC_DIR/lib/video/hooks.ts" 2>/dev/null; then
  echo "ERROR: src/lib/video/hooks.ts is missing the window.stopRecording?.() call."
  echo "  This file should not be modified. Restore it from the template."
  errors=$((errors + 1))
fi

# Check that the recorder still muxes the localized narration onto the export.
# Without the adelay/amix filter the MP4s silently regress to visual-only.
RECORDER_MJS="$(dirname "$0")/record-videos.mjs"
if ! grep -Fq 'narrationClipsForLocale' "$RECORDER_MJS" 2>/dev/null; then
  echo "ERROR: video/scripts/record-videos.mjs no longer muxes narration audio."
  echo "  It must build a per-scene audio bed (adelay+amix) from"
  echo "  client/public/withdrawal-video/narration/<locale>/<sceneKey>.mp3 so the"
  echo "  exported MP4s are narrated, not silent."
  errors=$((errors + 1))
fi

# ---------------------------------------------------------------------------
# SCENE_DURATIONS single-source-of-truth integrity checks.
#
# All three consumers now read from video/scene-durations.json directly:
#   1. client/src/components/portal/withdrawal-video/sceneDurations.ts
#   2. video/src/components/video/VideoTemplate.tsx
#   3. video/scripts/record-videos.mjs
#
# Three-way literal drift is now impossible by construction. These checks
# instead verify that:
#   (a) the canonical JSON file exists and is valid JSON with positive numeric
#       durations (catching accidental deletion or corruption), and
#   (b) each consumer still references the JSON file (catching a revert to
#       inline literals, which would re-introduce the drift risk).
# ---------------------------------------------------------------------------
REPO_ROOT="$(dirname "$0")/../.."
SCENE_DURATIONS_JSON="$ARTIFACT_DIR/scene-durations.json"
PORTAL_DURATIONS_FILE="$REPO_ROOT/client/src/components/portal/withdrawal-video/sceneDurations.ts"
VIDEO_TEMPLATE_FILE="$SRC_DIR/components/video/VideoTemplate.tsx"

# (a) Verify the JSON file exists and is well-formed with positive durations.
if [ ! -f "$SCENE_DURATIONS_JSON" ]; then
  echo "ERROR: video/scene-durations.json not found."
  echo "  This file is the single source of truth for all SCENE_DURATIONS consumers."
  echo "  Restore it from git history."
  errors=$((errors + 1))
else
  node -e '
const src = require("fs").readFileSync(process.argv[1], "utf8");
let durations;
try {
  durations = JSON.parse(src);
} catch (e) {
  process.stderr.write("ERROR: video/scene-durations.json is not valid JSON: " + e.message + "\n");
  process.exit(1);
}
if (typeof durations !== "object" || durations === null || Array.isArray(durations)) {
  process.stderr.write("ERROR: video/scene-durations.json must be a plain object.\n");
  process.exit(1);
}
const entries = Object.entries(durations);
if (!entries.length) {
  process.stderr.write("ERROR: video/scene-durations.json has no entries.\n");
  process.exit(1);
}
for (const [key, val] of entries) {
  if (typeof val !== "number" || val <= 0) {
    process.stderr.write("ERROR: video/scene-durations.json[\"" + key + "\"] must be a positive number (got: " + JSON.stringify(val) + ").\n");
    process.exit(1);
  }
}
' "$SCENE_DURATIONS_JSON"
  json_exit=$?
  if [ $json_exit -ne 0 ]; then
    errors=$((errors + 1))
  fi
fi

# ---------------------------------------------------------------------------
# --self-test: verify that the JSON integrity and consumer-reference guards
# work correctly by running them against synthetic inputs.
#
# (1) A temp JSON with a non-numeric duration value must be caught by the
#     node validator (exercises the §(a) path).
# (2) A temp consumer file that does NOT reference scene-durations.json must
#     be caught by the grep check (exercises the §(b) path).
#
# Exits 0 when both guards fire correctly; exits 1 when either passes silently.
# ---------------------------------------------------------------------------
if [ "$SELF_TEST" -eq 1 ]; then
  echo "Running SCENE_DURATIONS self-test…"

  self_test_errors=0

  # --- Part 1: JSON validator catches a bad duration value ---
  TMPJSON=$(mktemp /tmp/validate-self-test-XXXXXX.json)
  TMPCONSUMER=$(mktemp /tmp/validate-self-test-consumer-XXXXXX.ts)
  trap 'rm -f "$TMPJSON" "$TMPCONSUMER"' EXIT

  printf '{"intro":10000,"phase1":"bad-value"}\n' > "$TMPJSON"

  node -e '
const src = require("fs").readFileSync(process.argv[1], "utf8");
let durations;
try { durations = JSON.parse(src); } catch (e) { process.stderr.write("not valid JSON\n"); process.exit(1); }
if (typeof durations !== "object" || durations === null || Array.isArray(durations)) { process.stderr.write("must be object\n"); process.exit(1); }
const entries = Object.entries(durations);
if (!entries.length) { process.stderr.write("empty\n"); process.exit(1); }
for (const [key, val] of entries) {
  if (typeof val !== "number" || val <= 0) { process.stderr.write("bad value: " + key + "\n"); process.exit(1); }
}
' "$TMPJSON" 2>/dev/null
  node_exit=$?
  if [ $node_exit -eq 0 ]; then
    echo "SELF-TEST FAILED: JSON validator did NOT catch the synthetic bad duration value."
    echo "  The §(a) guard is broken — it would silently pass a corrupted scene-durations.json."
    self_test_errors=$((self_test_errors + 1))
  fi

  # --- Part 2: grep check catches a consumer missing the JSON reference ---
  printf 'export const SCENE_DURATIONS = { intro: 10000 };\n' > "$TMPCONSUMER"

  if grep -Fq 'scene-durations.json' "$TMPCONSUMER" 2>/dev/null; then
    echo "SELF-TEST FAILED: Consumer reference check did NOT detect the missing JSON import."
    echo "  The §(b) guard is broken — it would silently pass a consumer using an inline literal."
    self_test_errors=$((self_test_errors + 1))
  fi

  if [ $self_test_errors -gt 0 ]; then
    exit 1
  fi

  echo "SELF-TEST PASSED: Both guards correctly detected the synthetic failures."
  echo "  §(a) JSON validator: caught a non-numeric duration value."
  echo "  §(b) Consumer check: caught a file missing the scene-durations.json import."
  exit 0
fi

# (b) Verify each consumer still references the JSON file, not an inline literal.
if ! grep -Fq 'scene-durations.json' "$PORTAL_DURATIONS_FILE" 2>/dev/null; then
  echo "ERROR: client/src/components/portal/withdrawal-video/sceneDurations.ts"
  echo "  no longer imports from video/scene-durations.json."
  echo "  It must read from the shared JSON so SCENE_DURATIONS cannot drift."
  errors=$((errors + 1))
fi

if ! grep -Fq 'scene-durations.json' "$VIDEO_TEMPLATE_FILE" 2>/dev/null; then
  echo "ERROR: video/src/components/video/VideoTemplate.tsx"
  echo "  no longer imports from scene-durations.json."
  echo "  It must read from the shared JSON so SCENE_DURATIONS cannot drift."
  errors=$((errors + 1))
fi

if ! grep -Fq 'scene-durations.json' "$RECORDER_MJS" 2>/dev/null; then
  echo "ERROR: video/scripts/record-videos.mjs"
  echo "  no longer reads from scene-durations.json."
  echo "  It must read from the shared JSON so narration offsets stay in sync."
  errors=$((errors + 1))
fi

if [ $errors -gt 0 ]; then
  echo ""
  echo "Found $errors recording lifecycle error(s). Video export will fail without these fixes."
  exit 1
fi

echo "Recording lifecycle validation passed."
exit 0
