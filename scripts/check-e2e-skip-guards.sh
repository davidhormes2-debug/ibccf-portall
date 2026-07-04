#!/usr/bin/env bash
# check-e2e-skip-guards.sh
#
# Parses every e2e/*.spec.ts file, extracts the env-var names referenced inside
# test.skip() conditions, then verifies that each one is declared in the
# target CI workflow's env: block.
#
# Exit codes:
#   0 — all skip-guard variables are present in the workflow(s)
#   1 — one or more variables are missing (prints a clear diagnostic)
#
# Usage:
#   bash scripts/check-e2e-skip-guards.sh
#       Checks all workflows that run Playwright/e2e specs (recommended).
#
#   bash scripts/check-e2e-skip-guards.sh --all
#       Same as above — explicitly enumerate every .github/workflows/*.yml that
#       contains "npm run test:e2e" or "playwright" and check each one.
#       This is what both e2e-tests.yml and smoke-test.yml call so that any
#       future Playwright workflow is caught automatically without needing to
#       update either of them.
#
#   bash scripts/check-e2e-skip-guards.sh --workflow .github/workflows/smoke-test.yml
#       Check a single workflow explicitly (useful for local debugging).
#
#   # or from repo root: npm run check:skip-guards
#
# ── Preferred pattern for new specs ──────────────────────────────────────────
#
# Instead of a top-level test.skip() condition, new specs should assert in
# beforeAll so a missing variable causes a hard failure (not a silent skip):
#
#   test.beforeAll(() => {
#     if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
#       throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD must be set …");
#     }
#   });
#
# Hard assertions in beforeAll are self-enforcing: CI fails loudly regardless
# of whether the variable appears in the workflow env: block, so they do NOT
# need to be tracked by this script.
#
# Use test.skip() only for genuinely optional features where a graceful skip
# is preferable to a hard failure (e.g. optional third-party services).
#
# ── Adding a new Playwright workflow ─────────────────────────────────────────
#
# No action required.  Any .github/workflows/*.yml file whose content contains
# "npm run test:e2e" or "playwright" (case-insensitive) is automatically
# discovered and checked when the script runs in --all mode.  Just ensure the
# new workflow's env: block declares every env var referenced in test.skip()
# conditions across e2e/*.spec.ts.
#
# ── Declaring skip-guard variables in a workflow ─────────────────────────────
#
# Plain env var (fixed / throwaway CI value):
#   env:
#     MY_VAR: some-value
#
# Secret (real credential passed from GitHub Secrets):
#   env:
#     MY_VAR: ${{ secrets.MY_VAR }}
#
# Both forms are accepted by this script because the check only requires
# that the YAML key "MY_VAR:" appears somewhere in the workflow file's
# indented env: block.  The value (plain string or secrets expression) does
# not matter — what matters is that the key is present so the env var is
# not empty/unset when the spec runs, preventing silent test-skipping.
# ---------------------------------------------------------------------------

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SPEC_DIR="$REPO_ROOT/e2e"
WORKFLOWS_DIR="$REPO_ROOT/.github/workflows"

# ---------------------------------------------------------------------------
# 0. Argument parsing
#    (no flags)       Auto-discover and check all Playwright workflows (default).
#    --all            Same as default — auto-discover all Playwright workflows.
#    --workflow <path>  Check a single workflow (absolute or relative to repo root).
# ---------------------------------------------------------------------------
MODE="all"          # "all" or "single"
WORKFLOW_REL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      MODE="all"
      shift
      ;;
    --workflow)
      if [[ -z "${2-}" ]]; then
        echo "ERROR: --workflow requires a path argument" >&2
        exit 1
      fi
      MODE="single"
      WORKFLOW_REL="$2"
      shift 2
      ;;
    *)
      echo "ERROR: Unknown argument: $1" >&2
      echo "Usage: $0 [--all | --workflow <path>]" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# 1. Sanity-check inputs
# ---------------------------------------------------------------------------
if [[ ! -d "$SPEC_DIR" ]]; then
  echo "ERROR: e2e spec directory not found: $SPEC_DIR" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Extract env-var names referenced in test.skip() conditions across all specs
#
# Strategy: grab the line immediately after every `test.skip(` call (that is
# where the boolean condition lives in every existing spec), then pull out
# any ALL_CAPS identifier that is negated with `!`.
#
# Pattern matched: `!IDENTIFIER` where IDENTIFIER is [A-Z][A-Z0-9_]+
# This deliberately ignores `test.skip(true, ...)` style calls which carry no
# variable reference.
# ---------------------------------------------------------------------------
SKIP_GUARD_VARS=""

for spec in "$SPEC_DIR"/*.spec.ts; do
  [[ -f "$spec" ]] || continue

  # -A1: one line of context after the match gives us the condition argument.
  # -h:  suppress filename prefix.
  condition_lines=$(grep -A1 -h "test\.skip(" "$spec" || true)

  # Extract !UPPER_CASE_VAR patterns, strip the leading !
  vars=$(printf '%s\n' "$condition_lines" \
    | grep -oE '![A-Z][A-Z0-9_]+' \
    | sed 's/^!//' \
    || true)

  if [[ -n "$vars" ]]; then
    SKIP_GUARD_VARS=$(printf '%s\n%s' "$SKIP_GUARD_VARS" "$vars")
  fi
done

# Deduplicate and sort
SKIP_GUARD_VARS=$(printf '%s\n' "$SKIP_GUARD_VARS" \
  | sed '/^[[:space:]]*$/d' \
  | sort -u)

if [[ -z "$SKIP_GUARD_VARS" ]]; then
  echo "check-e2e-skip-guards: no skip-guard env vars found in e2e specs — nothing to verify."
  exit 0
fi

echo "check-e2e-skip-guards: skip-guard variables found in e2e specs:"
printf '  %s\n' $SKIP_GUARD_VARS

# ---------------------------------------------------------------------------
# 3. Build the list of workflows to check
# ---------------------------------------------------------------------------
if [[ "$MODE" == "single" ]]; then
  # Resolve to absolute path (accept both absolute and repo-root-relative)
  if [[ "$WORKFLOW_REL" = /* ]]; then
    WORKFLOW_PATHS=("$WORKFLOW_REL")
  else
    WORKFLOW_PATHS=("$REPO_ROOT/$WORKFLOW_REL")
  fi

  if [[ ! -f "${WORKFLOW_PATHS[0]}" ]]; then
    echo "ERROR: CI workflow not found: ${WORKFLOW_PATHS[0]}" >&2
    exit 1
  fi
else
  # --all mode: auto-discover every workflow that runs Playwright or test:e2e.
  # A workflow qualifies if its content (case-insensitive) contains either
  # "npm run test:e2e" or "playwright".
  WORKFLOW_PATHS=()
  if [[ -d "$WORKFLOWS_DIR" ]]; then
    while IFS= read -r -d '' wf; do
      if grep -qiE "(npm run test:e2e|playwright)" "$wf" 2>/dev/null; then
        WORKFLOW_PATHS+=("$wf")
      fi
    done < <(find "$WORKFLOWS_DIR" -maxdepth 1 -name "*.yml" -print0 | sort -z)
  fi

  if [[ ${#WORKFLOW_PATHS[@]} -eq 0 ]]; then
    echo "check-e2e-skip-guards: no Playwright/e2e workflows found in $WORKFLOWS_DIR — nothing to verify."
    exit 0
  fi

  echo ""
  echo "check-e2e-skip-guards: discovered ${#WORKFLOW_PATHS[@]} Playwright/e2e workflow(s):"
  for wf in "${WORKFLOW_PATHS[@]}"; do
    printf '  %s\n' "${wf#"$REPO_ROOT/"}"
  done
fi

# ---------------------------------------------------------------------------
# 4. Check each workflow
#
# For each workflow, verify that every skip-guard variable appears as a YAML
# key inside an env: block, i.e. a line matching /^\s+VAR_NAME:/.
#
# Accepted YAML forms (both are matched by the key-presence check):
#
#   Plain value  →  MY_VAR: some-value
#   Secret       →  MY_VAR: ${{ secrets.MY_VAR }}
#
# The regex checks only that the YAML key "MY_VAR:" exists as an indented
# entry; the right-hand-side value is intentionally ignored.
# ---------------------------------------------------------------------------
OVERALL_FAILED=0

for WORKFLOW in "${WORKFLOW_PATHS[@]}"; do
  WORKFLOW_DISPLAY="${WORKFLOW#"$REPO_ROOT/"}"
  echo ""
  echo "check-e2e-skip-guards: checking against workflow: $WORKFLOW_DISPLAY"

  MISSING=""
  for var in $SKIP_GUARD_VARS; do
    if ! grep -qE "^\s+${var}:" "$WORKFLOW"; then
      MISSING=$(printf '%s\n%s' "$MISSING" "$var")
    fi
  done

  MISSING=$(printf '%s\n' "$MISSING" | sed '/^[[:space:]]*$/d')

  if [[ -n "$MISSING" ]]; then
    echo "" >&2
    echo "ERROR: The following env vars are used in test.skip() conditions but" >&2
    echo "       are NOT declared in the workflow env: block ($WORKFLOW_DISPLAY):" >&2
    printf '  MISSING: %s\n' $MISSING >&2
    echo "" >&2
    echo "  Tests that depend on these variables will silently skip in CI." >&2
    echo "  Add each variable to the 'env:' section of the workflow." >&2
    echo "  For a plain value:  MY_VAR: some-value" >&2
    echo "  For a real secret:  MY_VAR: \${{ secrets.MY_VAR }}" >&2
    OVERALL_FAILED=1
  else
    echo "check-e2e-skip-guards: all skip-guard variables are present in $WORKFLOW_DISPLAY. OK."
  fi
done

# ---------------------------------------------------------------------------
# 5. Final summary
# ---------------------------------------------------------------------------
echo ""
if [[ "$OVERALL_FAILED" -ne 0 ]]; then
  echo "check-e2e-skip-guards: FAILED — one or more workflows are missing skip-guard variables (see above)." >&2
  exit 1
fi

echo "check-e2e-skip-guards: all skip-guard variables are present in all checked workflow(s). OK."
