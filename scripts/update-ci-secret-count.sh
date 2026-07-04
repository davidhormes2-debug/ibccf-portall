#!/usr/bin/env bash
# scripts/update-ci-secret-count.sh
#
# Reads the actual length of the secrets=() array in smoke-test.yml and
# rewrites every hardcoded count in CI_SETUP.md and smoke-test.yml to match.
#
# Usage (from the repository root):
#   bash scripts/update-ci-secret-count.sh
#
# The script is idempotent — running it when the counts are already correct
# makes no changes and exits 0.

set -euo pipefail

WORKFLOW_FILE=".github/workflows/smoke-test.yml"
DOCS_FILE="CI_SETUP.md"

# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------
if [ ! -f "$WORKFLOW_FILE" ]; then
  echo "ERROR: $WORKFLOW_FILE not found. Run this script from the repository root." >&2
  exit 1
fi

if [ ! -f "$DOCS_FILE" ]; then
  echo "ERROR: $DOCS_FILE not found. Run this script from the repository root." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Extract actual count from the secrets=() array in smoke-test.yml
# ---------------------------------------------------------------------------
workflow_secrets_raw=$(awk '
  /secrets=\(/ { found=1 }
  found { print }
  found && /\)/ { exit }
' "$WORKFLOW_FILE")

actual_count=$(echo "$workflow_secrets_raw" \
  | grep -oE '[A-Z][A-Z0-9_]{2,}' \
  | sort -u \
  | grep -c '[A-Z]')

if [ -z "$actual_count" ] || [ "$actual_count" -eq 0 ]; then
  echo "ERROR: Could not extract the secrets array from $WORKFLOW_FILE." >&2
  exit 1
fi

echo "Actual secret count from $WORKFLOW_FILE: $actual_count"

# ---------------------------------------------------------------------------
# Rewrite counts in CI_SETUP.md
#
# Two patterns to update:
#   requires **12 GitHub repository secrets**
#   all 12 required secrets are non-empty
# ---------------------------------------------------------------------------
docs_changed=0

if grep -qE '[0-9]+ GitHub repository secrets' "$DOCS_FILE"; then
  old=$(grep -oE '[0-9]+ GitHub repository secrets' "$DOCS_FILE" | grep -oE '^[0-9]+' | head -1)
  if [ "$old" != "$actual_count" ]; then
    sed -i "s/\b${old} GitHub repository secrets\b/${actual_count} GitHub repository secrets/g" "$DOCS_FILE"
    echo "Updated $DOCS_FILE: 'GitHub repository secrets' count $old → $actual_count"
    docs_changed=1
  else
    echo "No change needed in $DOCS_FILE (GitHub repository secrets count already $actual_count)"
  fi
else
  echo "WARNING: Could not find 'N GitHub repository secrets' pattern in $DOCS_FILE — skipping." >&2
fi

# Also update "all 12 required secrets are non-empty" in the job description prose
if grep -qiE 'all [0-9]+ required secrets are non-empty' "$DOCS_FILE"; then
  old2=$(grep -ioE 'all [0-9]+ required secrets are non-empty' "$DOCS_FILE" | grep -oE '[0-9]+' | head -1)
  if [ "$old2" != "$actual_count" ]; then
    # case-insensitive replacement via two passes (upper/lower first char)
    sed -i "s/[Aa]ll ${old2} required secrets are non-empty/all ${actual_count} required secrets are non-empty/gI" "$DOCS_FILE" 2>/dev/null || \
      sed -i "s/[Aa]ll ${old2} required secrets are non-empty/all ${actual_count} required secrets are non-empty/g" "$DOCS_FILE"
    echo "Updated $DOCS_FILE: 'required secrets are non-empty' count $old2 → $actual_count"
    docs_changed=1
  fi
fi

# Update "Checks that all 12 required secrets" prose
if grep -qE 'Checks that all [0-9]+ required secrets' "$DOCS_FILE"; then
  old3=$(grep -oE 'Checks that all [0-9]+ required secrets' "$DOCS_FILE" | grep -oE '[0-9]+' | head -1)
  if [ "$old3" != "$actual_count" ]; then
    sed -i "s/Checks that all ${old3} required secrets/Checks that all ${actual_count} required secrets/g" "$DOCS_FILE"
    echo "Updated $DOCS_FILE: 'Checks that all N required secrets' count $old3 → $actual_count"
    docs_changed=1
  fi
fi

if [ "$docs_changed" -eq 0 ]; then
  echo "No changes made to $DOCS_FILE."
fi

# ---------------------------------------------------------------------------
# Rewrite count in smoke-test.yml
#
# Pattern: All 12 required secrets are present.
# ---------------------------------------------------------------------------
workflow_changed=0

if grep -qE 'All [0-9]+ required secrets are present' "$WORKFLOW_FILE"; then
  old_wf=$(grep -oE 'All [0-9]+ required secrets are present' "$WORKFLOW_FILE" | grep -oE '[0-9]+' | head -1)
  if [ "$old_wf" != "$actual_count" ]; then
    sed -i "s/All ${old_wf} required secrets are present/All ${actual_count} required secrets are present/g" "$WORKFLOW_FILE"
    echo "Updated $WORKFLOW_FILE: echo count $old_wf → $actual_count"
    workflow_changed=1
  else
    echo "No change needed in $WORKFLOW_FILE (echo count already $actual_count)"
  fi
else
  echo "WARNING: Could not find 'All N required secrets are present' pattern in $WORKFLOW_FILE — skipping." >&2
fi

if [ "$workflow_changed" -eq 0 ]; then
  echo "No changes made to $WORKFLOW_FILE."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
if [ "$docs_changed" -eq 0 ] && [ "$workflow_changed" -eq 0 ]; then
  echo "All counts were already correct — no files modified."
else
  echo "Done. Count updated to $actual_count in all relevant locations."
fi
