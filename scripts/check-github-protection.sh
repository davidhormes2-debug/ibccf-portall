#!/usr/bin/env bash
# scripts/check-github-protection.sh
#
# Verifies that the branch protection rule for `main` is correctly configured.
# The list of required status checks is read from scripts/required-checks.txt
# (one check context string per line) — that file is the single source of truth.
#
# Prerequisites:
#   - GitHub CLI (gh) installed and authenticated: gh auth login
#   - The authenticated account must have at least Read access to the repository.
#
# Usage:
#   bash scripts/check-github-protection.sh [--enforce-admins] [OWNER/REPO]
#
# OWNER/REPO defaults to the repository reported by `gh repo view`.
# --enforce-admins  Also verify that enforce_admins is enabled (admins must
#                   pass the smoke test before merging — no bypass allowed).
# Exits 0 if all required checks are present (and enforce_admins matches when
# --enforce-admins is passed), 1 otherwise.

set -euo pipefail

# ---------------------------------------------------------------------------
# Load the canonical list from required-checks.txt
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKS_FILE="$SCRIPT_DIR/required-checks.txt"

if [ ! -f "$CHECKS_FILE" ]; then
  echo "ERROR: $CHECKS_FILE not found." >&2
  echo "       This file is the single source of truth for required status checks." >&2
  exit 1
fi

mapfile -t REQUIRED_CHECKS < <(grep '[^[:space:]]' "$CHECKS_FILE")

if [ "${#REQUIRED_CHECKS[@]}" -eq 0 ]; then
  echo "ERROR: $CHECKS_FILE is empty — nothing to verify." >&2
  exit 1
fi

CHECK_ENFORCE_ADMINS=false

# Accumulates one or more space-separated reason tokens:
#   no_protection_rule | required_checks_missing | enforce_admins_disabled
# Written to $GITHUB_OUTPUT (when available) before every exit 1 so the
# workflow's notify job can surface the specific cause in alerts.
FAILURE_REASON=""

# ---------------------------------------------------------------------------
# Helper: record reason token and, when running inside GitHub Actions, flush
# all accumulated tokens to $GITHUB_OUTPUT as failure_reason=<value>.
# Call this immediately before every `exit 1`.
# ---------------------------------------------------------------------------
_emit_failure_reason() {
  local reason="${1:-unknown}"
  # Append to accumulated reasons (space-separated, deduped is fine).
  if [ -z "$FAILURE_REASON" ]; then
    FAILURE_REASON="$reason"
  else
    FAILURE_REASON="$FAILURE_REASON $reason"
  fi
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "failure_reason=$FAILURE_REASON" >> "$GITHUB_OUTPUT"
  fi
}

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
POSITIONAL_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --enforce-admins)
      CHECK_ENFORCE_ADMINS=true
      ;;
    *)
      POSITIONAL_ARGS+=("$arg")
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Resolve repository
# ---------------------------------------------------------------------------
if [ "${#POSITIONAL_ARGS[@]}" -gt 0 ] && [ -n "${POSITIONAL_ARGS[0]-}" ]; then
  REPO="${POSITIONAL_ARGS[0]}"
else
  REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
  if [ -z "$REPO" ]; then
    echo "ERROR: Could not determine the repository. Either pass OWNER/REPO as" >&2
    echo "       the first argument or run 'gh auth login' and try again." >&2
    exit 1
  fi
fi

echo "Checking branch protection for: $REPO (branch: main)"
echo ""

# ---------------------------------------------------------------------------
# Fetch required check contexts via --jq for reliable structured parsing.
# `gh api --jq` uses jq internally, so spacing in the API response is irrelevant.
# The query returns one context per line, or an empty string when the array
# is absent/null (the `// empty` suppresses jq "null" output).
# ---------------------------------------------------------------------------
API_ERROR=$(mktemp)
CONFIGURED_CHECKS=$(gh api \
  --method GET \
  --header "Accept: application/vnd.github+json" \
  --jq '.required_status_checks.checks // [] | .[].context' \
  "/repos/$REPO/branches/main/protection" 2>"$API_ERROR") || {
  API_ERR_MSG=$(cat "$API_ERROR")
  rm -f "$API_ERROR"
  if echo "$API_ERR_MSG" | grep -qi "branch not protected\|404"; then
    echo "FAIL: Branch 'main' has no protection rule configured." >&2
    echo "      Run 'bash scripts/setup-github-protection.sh' to apply one." >&2
  else
    echo "FAIL: Could not fetch branch protection — GitHub API error:" >&2
    echo "      $API_ERR_MSG" >&2
  fi
  _emit_failure_reason "no_protection_rule"
  exit 1
}
rm -f "$API_ERROR"

if [ -z "$CONFIGURED_CHECKS" ]; then
  echo "FAIL: Branch protection exists but no required status checks are configured." >&2
  echo "      Run 'bash scripts/setup-github-protection.sh' to apply the correct rule." >&2
  _emit_failure_reason "required_checks_missing"
  exit 1
fi

# ---------------------------------------------------------------------------
# Verify each required check is present (exact line match)
# ---------------------------------------------------------------------------
ALL_PRESENT=true

CHECKS_FAILED=false
for CHECK in "${REQUIRED_CHECKS[@]}"; do
  if echo "$CONFIGURED_CHECKS" | grep -qxF "$CHECK"; then
    echo "  PASS  $CHECK"
  else
    echo "  FAIL  $CHECK  (not found in required checks)" >&2
    ALL_PRESENT=false
    CHECKS_FAILED=true
  fi
done

# ---------------------------------------------------------------------------
# Verify enforce_admins when --enforce-admins flag is passed
# ---------------------------------------------------------------------------
if [ "$CHECK_ENFORCE_ADMINS" = true ]; then
  ENFORCE_ADMINS_ENABLED=$(gh api \
    --method GET \
    --header "Accept: application/vnd.github+json" \
    --jq '.enforce_admins.enabled' \
    "/repos/$REPO/branches/main/protection" 2>/dev/null || echo "false")

  if [ "$ENFORCE_ADMINS_ENABLED" = "true" ]; then
    echo "  PASS  enforce_admins (admins must also pass required checks)"
  else
    echo "  FAIL  enforce_admins is not enabled — admins can bypass required checks" >&2
    echo "        Run 'bash scripts/setup-github-protection.sh --enforce-admins' to fix this." >&2
    ALL_PRESENT=false
    _emit_failure_reason "enforce_admins_disabled"
  fi
fi

echo ""

# ---------------------------------------------------------------------------
# Report result
# ---------------------------------------------------------------------------
if [ "$ALL_PRESENT" = true ]; then
  echo "Branch protection is correctly configured — all required checks are present."
  exit 0
else
  # Emit any remaining reasons accumulated from the required-checks loop.
  [ "$CHECKS_FAILED" = true ] && _emit_failure_reason "required_checks_missing"
  echo "Branch protection is misconfigured. Run 'bash scripts/setup-github-protection.sh'" >&2
  echo "to apply the correct rule, then re-run this script to verify." >&2
  exit 1
fi
