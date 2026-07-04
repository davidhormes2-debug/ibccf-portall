#!/usr/bin/env bash
# check-hardcoded-prefixes.sh
#
# Guards against hardcoding the BATCH_FEE_NOTES_PREFIX literal string
# ("Batch merge fee: ") directly in e2e spec files instead of referencing
# the shared constant exported from shared/constants.ts.
#
# When this string is hardcoded it silently drifts whenever the constant
# is updated, causing false passes or false failures in e2e tests.
#
#   BAD: expect(row).toContainText("Batch merge fee: 50")
#   BAD: await expect(cell).toContainText("Batch merge fee: 0.50 USDT")
#   OK:  expect(row).toContainText(`${BATCH_FEE_NOTES_PREFIX}50`)
#   OK:  import { BATCH_FEE_NOTES_PREFIX } from '../../shared/constants'
#
# Scanned directory: e2e/ (*.spec.ts files only)
#
# Exit codes:
#   0 — no hardcoded prefix strings found
#   1 — one or more violations detected (prints a clear diagnostic)
#
# Usage:
#   bash scripts/check-hardcoded-prefixes.sh
#   npm run lint:hardcoded-prefixes
#
# To suppress a deliberate false-positive on a specific line, append:
#   // hardcoded-prefix-ok
# ---------------------------------------------------------------------------

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Extract the current value of BATCH_FEE_NOTES_PREFIX directly from
# shared/constants.ts so this guard stays correct when the constant changes.
# Handles both double-quoted and single-quoted string literals.
LITERAL=$(grep -E '^export const BATCH_FEE_NOTES_PREFIX\s*=' \
  "$REPO_ROOT/shared/constants.ts" \
  | sed -E "s/.*=\s*[\"']([^\"']+)[\"'].*/\1/")

if [[ -z "$LITERAL" ]]; then
  echo "check-hardcoded-prefixes: ERROR: could not extract BATCH_FEE_NOTES_PREFIX from shared/constants.ts" >&2
  exit 1
fi

raw=$(grep -rFn "$LITERAL" "$REPO_ROOT/e2e" --include="*.spec.ts" 2>/dev/null || true)

if [[ -z "$raw" ]]; then
  echo "check-hardcoded-prefixes: no hardcoded prefix strings found. OK."
  exit 0
fi

violations=""
while IFS= read -r line; do
  [[ -z "$line" ]] && continue

  # Strip the "path:lineno:" prefix to get the raw content for analysis.
  content="${line#*:*:}"

  # Skip pure comment lines (trimmed content starts with //).
  trimmed="${content#"${content%%[![:space:]]*}"}"
  [[ "$trimmed" == //* ]] && continue

  # Skip import lines — importing the constant is correct usage.
  [[ "$trimmed" == import\ * ]] && continue

  # Skip lines carrying the suppression annotation.
  [[ "$content" == *"hardcoded-prefix-ok"* ]] && continue

  violations+="${line}"$'\n'
done <<< "$raw"

violations="${violations%$'\n'}"

if [[ -z "$violations" ]]; then
  echo "check-hardcoded-prefixes: no hardcoded prefix strings found. OK."
  exit 0
fi

violation_count=$(printf '%s\n' "$violations" | grep -c .)

echo "" >&2
echo "ERROR: Hardcoded BATCH_FEE_NOTES_PREFIX literal found in e2e spec files." >&2
echo "" >&2
echo "  Embedding the raw string \"${LITERAL}\" in a spec couples the test" >&2
echo "  to the current wording.  If the constant ever changes the spec will" >&2
echo "  silently pass or fail against stale text." >&2
echo "" >&2
echo "  Use the shared constant instead:" >&2
echo "    BAD: expect(row).toContainText(\"${LITERAL}50\")" >&2
echo "    OK:  expect(row).toContainText(\`\${BATCH_FEE_NOTES_PREFIX}50\`)" >&2
echo "    OK:  import { BATCH_FEE_NOTES_PREFIX } from '../../shared/constants'" >&2
echo "" >&2
echo "  Violations found (${violation_count}):" >&2
while IFS= read -r v; do
  [[ -z "$v" ]] && continue
  echo "    $v" >&2
done <<< "$violations"
echo "" >&2
echo "  To suppress a deliberate false-positive, append: // hardcoded-prefix-ok" >&2
exit 1
