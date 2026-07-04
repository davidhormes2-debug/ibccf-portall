#!/usr/bin/env bash
# check-skip-guard-coverage.sh
#
# Meta-check: verifies that every CI workflow that runs e2e/Playwright specs
# also contains a "check-e2e-skip-guards.sh" step BEFORE the Playwright step.
#
# A workflow is considered to "run e2e specs" if it contains any of:
#   - npm run test:e2e
#   - npx playwright test
#   - playwright test          (bare invocation)
#
# Exit codes:
#   0 — every e2e-running workflow has the skip-guard check step
#   0 — (--warn-only) coverage gap found but only a warning is printed
#   1 — one or more workflows are missing the step (prints a clear diagnostic)
#
# Flags:
#   --warn-only   Print a warning on coverage gaps but exit 0.
#                 Intended for use in the pre-push hook where the developer
#                 may be working on a brand-new workflow file that hasn't been
#                 committed yet.  CI should always run without this flag so
#                 the check is enforced before merge.
#
# Usage:
#   bash scripts/check-skip-guard-coverage.sh                # strict (CI)
#   bash scripts/check-skip-guard-coverage.sh --warn-only    # lenient (local hook)
#   npm run check:skip-guard-coverage   (if wired into package.json)
#
# ── How to satisfy this check ────────────────────────────────────────────────
#
# Add the following step BEFORE the Playwright run step in the workflow:
#
#   - name: Check e2e skip-guard variables are in all Playwright workflow envs
#     run: bash scripts/check-e2e-skip-guards.sh --all
#
# Using --all means the step automatically covers every Playwright workflow
# in the repo, so no per-workflow --workflow flag is needed.
#
# ---------------------------------------------------------------------------

set -euo pipefail

WARN_ONLY=false
for arg in "$@"; do
  if [[ "$arg" == "--warn-only" ]]; then
    WARN_ONLY=true
  fi
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOWS_DIR="$REPO_ROOT/.github/workflows"

if [[ ! -d "$WORKFLOWS_DIR" ]]; then
  echo "check-skip-guard-coverage: no .github/workflows directory found — nothing to check."
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. Find all workflow files that invoke e2e / Playwright tests
# ---------------------------------------------------------------------------
E2E_WORKFLOWS=()

for wf in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
  [[ -f "$wf" ]] || continue

  if grep -qE \
    "(npm run test:e2e|npx playwright test|playwright test)" \
    "$wf"; then
    E2E_WORKFLOWS+=("$wf")
  fi
done

if [[ ${#E2E_WORKFLOWS[@]} -eq 0 ]]; then
  echo "check-skip-guard-coverage: no workflows invoke e2e specs — nothing to verify."
  exit 0
fi

echo "check-skip-guard-coverage: workflows that run e2e specs:"
for wf in "${E2E_WORKFLOWS[@]}"; do
  echo "  $(basename "$wf")"
done
echo ""

# ---------------------------------------------------------------------------
# 2. For each e2e workflow, verify it contains the skip-guard check step
# ---------------------------------------------------------------------------
MISSING=()

for wf in "${E2E_WORKFLOWS[@]}"; do
  if ! grep -q "check-e2e-skip-guards.sh" "$wf"; then
    MISSING+=("$(basename "$wf")")
  fi
done

# ---------------------------------------------------------------------------
# 3. Report result
# ---------------------------------------------------------------------------
if [[ ${#MISSING[@]} -gt 0 ]]; then
  if [[ "$WARN_ONLY" == true ]]; then
    echo "WARNING: The following workflows run e2e specs but are missing the" >&2
    echo "         'check-e2e-skip-guards.sh' step (warning only — push allowed):" >&2
  else
    echo "ERROR: The following workflows run e2e specs but are missing the" >&2
    echo "       'check-e2e-skip-guards.sh' step:" >&2
  fi
  for wf in "${MISSING[@]}"; do
    echo "  MISSING: $wf" >&2
  done
  echo "" >&2
  echo "  Add this step BEFORE the Playwright run step in each workflow:" >&2
  echo "" >&2
  echo "    - name: Check e2e skip-guard variables are in all Playwright workflow envs" >&2
  echo "      run: bash scripts/check-e2e-skip-guards.sh --all" >&2
  echo "" >&2
  echo "  Using --all covers every Playwright workflow automatically, so no" >&2
  echo "  per-workflow --workflow flag is needed." >&2
  echo "" >&2
  echo "  Without this step, test.skip() guards that reference missing env vars" >&2
  echo "  will silently skip tests in that workflow without any CI failure." >&2
  if [[ "$WARN_ONLY" == true ]]; then
    exit 0
  fi
  exit 1
fi

echo "check-skip-guard-coverage: all e2e workflows contain the skip-guard check step. OK."
