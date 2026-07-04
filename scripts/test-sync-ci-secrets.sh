#!/usr/bin/env bash
# scripts/test-sync-ci-secrets.sh
#
# Focused automated test for scripts/sync-ci-secrets.sh.
#
# Creates isolated temporary copies of smoke-test.yml, CI_SETUP.md, and
# server/env.ts that contain an existing secret (EXISTING_SECRET) but are
# missing a new one (MY_NEW_SECRET).  Runs the sync script against those
# temp files, then asserts:
#
#   1. The env: mapping for MY_NEW_SECRET was inserted into the workflow file.
#   2. MY_NEW_SECRET was appended to the secrets=() array.
#   3. A skeleton row for MY_NEW_SECRET was appended to the ## Required secrets table.
#   4. A second run (idempotency) makes no further changes to either file.
#
# Exits 0 on success, 1 on the first failing assertion (with a diagnostic message).
#
# Usage (from the repository root):
#   bash scripts/test-sync-ci-secrets.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC_SCRIPT="$SCRIPT_DIR/sync-ci-secrets.sh"

if [ ! -f "$SYNC_SCRIPT" ]; then
  echo "ERROR: $SYNC_SCRIPT not found." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
pass() { echo "  PASS: $*"; }
fail() {
  echo "  FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local label="$1" file="$2" pattern="$3"
  if grep -qF "$pattern" "$file"; then
    pass "$label"
  else
    fail "$label — pattern not found in $file: $pattern"
  fi
}

assert_not_contains() {
  local label="$1" file="$2" pattern="$3"
  if ! grep -qF "$pattern" "$file"; then
    pass "$label"
  else
    fail "$label — unexpected pattern found in $file: $pattern"
  fi
}

assert_files_equal() {
  local label="$1" file_a="$2" file_b="$3"
  if diff -q "$file_a" "$file_b" >/dev/null 2>&1; then
    pass "$label"
  else
    echo "  FAIL: $label — files differ:" >&2
    diff "$file_a" "$file_b" >&2 || true
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Temp directory setup
# ---------------------------------------------------------------------------
TMPDIR_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

WORKFLOW_DIR="$TMPDIR_ROOT/.github/workflows"
mkdir -p "$WORKFLOW_DIR"

WORKFLOW_FILE="$WORKFLOW_DIR/smoke-test.yml"
DOCS_FILE="$TMPDIR_ROOT/CI_SETUP.md"
SERVER_ENV_FILE="$TMPDIR_ROOT/env.ts"

# ---------------------------------------------------------------------------
# Fixture: smoke-test.yml
#
# Contains one existing secret (EXISTING_SECRET) in both the env: block and
# the secrets=() array.  MY_NEW_SECRET is intentionally absent so the sync
# script has work to do.
# ---------------------------------------------------------------------------
cat > "$WORKFLOW_FILE" <<'YAML'
name: Smoke Test

jobs:
  validate-secrets:
    name: Validate Required Secrets
    runs-on: ubuntu-latest
    steps:
      - name: Check all required secrets are present
        env:
          EXISTING_SECRET: ${{ secrets.EXISTING_SECRET }}
        run: |
          secrets=(EXISTING_SECRET)
          missing=()
          for secret in "${secrets[@]}"; do
            if [ -z "${!secret}" ]; then
              missing+=("$secret")
            fi
          done
          if [ "${#missing[@]}" -gt 0 ]; then
            exit 1
          fi
          echo "All 1 required secrets are present."
YAML

# ---------------------------------------------------------------------------
# Fixture: CI_SETUP.md
#
# Minimal document with a ## Required secrets table containing one existing
# entry.  MY_NEW_SECRET is absent.
# ---------------------------------------------------------------------------
cat > "$DOCS_FILE" <<'MARKDOWN'
# CI Setup

This workflow requires **1 GitHub repository secrets** to run.

## Required secrets

| Secret name | Description | Example value | Where to obtain |
|---|---|---|---|
| `EXISTING_SECRET` | An existing test secret | `placeholder` | Generate locally |

## Next section

Some other content here.
MARKDOWN

# ---------------------------------------------------------------------------
# Fixture: server/env.ts
#
# validateEnv() references both the existing secret and the new one.
# The sync script should detect that MY_NEW_SECRET is missing from the
# workflow and docs, then insert it in both places.
# ---------------------------------------------------------------------------
cat > "$SERVER_ENV_FILE" <<'TYPESCRIPT'
export function validateEnv() {
  const existing = process.env.EXISTING_SECRET;
  if (!existing) throw new Error("EXISTING_SECRET is required");

  const newSecret = process.env.MY_NEW_SECRET;
  if (!newSecret) throw new Error("MY_NEW_SECRET is required");
}
TYPESCRIPT

# ---------------------------------------------------------------------------
# Sanity-check: MY_NEW_SECRET must NOT be in the fixtures before we run
# ---------------------------------------------------------------------------
echo "Pre-run sanity checks..."
assert_not_contains \
  "MY_NEW_SECRET absent from workflow fixture before sync" \
  "$WORKFLOW_FILE" \
  "MY_NEW_SECRET"

assert_not_contains \
  "MY_NEW_SECRET absent from docs fixture before sync" \
  "$DOCS_FILE" \
  "MY_NEW_SECRET"

echo ""
echo "Running sync script (first pass)..."
WORKFLOW_FILE="$WORKFLOW_FILE" \
DOCS_FILE="$DOCS_FILE" \
SERVER_ENV_FILE="$SERVER_ENV_FILE" \
  bash "$SYNC_SCRIPT" >/dev/null 2>&1

# ---------------------------------------------------------------------------
# Assertions — workflow file
# ---------------------------------------------------------------------------
echo ""
echo "Asserting workflow file changes..."

assert_contains \
  "env: mapping inserted for MY_NEW_SECRET" \
  "$WORKFLOW_FILE" \
  "          MY_NEW_SECRET: \${{ secrets.MY_NEW_SECRET }}"

assert_contains \
  "MY_NEW_SECRET appended to secrets=() array" \
  "$WORKFLOW_FILE" \
  "MY_NEW_SECRET"

# Verify the array line contains both the old and the new secret.
array_line=$(grep -A5 'secrets=(' "$WORKFLOW_FILE" | tr -d '\n')
if echo "$array_line" | grep -q 'EXISTING_SECRET' && echo "$array_line" | grep -q 'MY_NEW_SECRET'; then
  pass "Both EXISTING_SECRET and MY_NEW_SECRET appear in secrets=() block"
else
  fail "Expected both EXISTING_SECRET and MY_NEW_SECRET in secrets=() block; got: $array_line"
fi

# ---------------------------------------------------------------------------
# Assertions — docs file
# ---------------------------------------------------------------------------
echo ""
echo "Asserting docs file changes..."

assert_contains \
  "Skeleton row inserted for MY_NEW_SECRET in ## Required secrets table" \
  "$DOCS_FILE" \
  "| \`MY_NEW_SECRET\`"

assert_contains \
  "Skeleton row contains _TODO: add description_ placeholder" \
  "$DOCS_FILE" \
  "_TODO: add description_"

# Verify the skeleton row is inside the ## Required secrets section (before the next ## heading).
table_block=$(awk '/^## Required secrets/{found=1;next} found && /^## /{exit} found{print}' "$DOCS_FILE")
if echo "$table_block" | grep -q 'MY_NEW_SECRET'; then
  pass "Skeleton row is inside the ## Required secrets section"
else
  fail "Skeleton row for MY_NEW_SECRET was not found inside ## Required secrets section"
fi

# ---------------------------------------------------------------------------
# Idempotency — snapshot files then run again; content must be unchanged
# ---------------------------------------------------------------------------
echo ""
echo "Taking post-sync snapshots for idempotency check..."
SNAPSHOT_WORKFLOW="$TMPDIR_ROOT/workflow.snap"
SNAPSHOT_DOCS="$TMPDIR_ROOT/docs.snap"
cp "$WORKFLOW_FILE" "$SNAPSHOT_WORKFLOW"
cp "$DOCS_FILE"     "$SNAPSHOT_DOCS"

echo "Running sync script (second pass — idempotency)..."
WORKFLOW_FILE="$WORKFLOW_FILE" \
DOCS_FILE="$DOCS_FILE" \
SERVER_ENV_FILE="$SERVER_ENV_FILE" \
  bash "$SYNC_SCRIPT" >/dev/null 2>&1

echo ""
echo "Asserting idempotency..."
assert_files_equal \
  "Workflow file unchanged on second run" \
  "$WORKFLOW_FILE" \
  "$SNAPSHOT_WORKFLOW"

assert_files_equal \
  "Docs file unchanged on second run" \
  "$DOCS_FILE" \
  "$SNAPSHOT_DOCS"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "All assertions passed."
