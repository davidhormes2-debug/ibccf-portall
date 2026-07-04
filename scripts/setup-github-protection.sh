#!/usr/bin/env bash
# scripts/setup-github-protection.sh
#
# Creates or updates the branch protection rule for `main` so that all required
# checks must pass before any PR can be merged.
#
# The list of required status checks is read from scripts/required-checks.txt
# (one check context string per line) — that file is the single source of truth.
# To require a new check, add it to required-checks.txt only; this script and
# scripts/check-github-protection.sh both read from that file automatically.
#
# Prerequisites:
#   - GitHub CLI (gh) installed and authenticated: gh auth login
#   - The authenticated account must have Admin access to the repository.
#   - The smoke-test workflow must have run at least once so GitHub has
#     registered the check names. If the checks don't appear yet, push a
#     commit to main or trigger the workflow manually first.
#
# Usage:
#   bash scripts/setup-github-protection.sh [--enforce-admins] [OWNER/REPO]
#
# Options:
#   --enforce-admins  Set enforce_admins: true so repository admins are also
#                     required to pass the status checks before merging.
#                     Without this flag, admins can still force-merge even
#                     when the smoke test is failing.
#
# OWNER/REPO defaults to the repository reported by `gh repo view`.
# Safe to re-run — the PUT call is idempotent.

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
  echo "ERROR: $CHECKS_FILE is empty — nothing to configure." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
ENFORCE_ADMINS=false

args=()
for arg in "$@"; do
  if [ "$arg" = "--enforce-admins" ]; then
    ENFORCE_ADMINS=true
  else
    args+=("$arg")
  fi
done

# ---------------------------------------------------------------------------
# Resolve repository
# ---------------------------------------------------------------------------
if [ "${#args[@]}" -gt 0 ] && [ -n "${args[0]-}" ]; then
  REPO="${args[0]}"
else
  REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
  if [ -z "$REPO" ]; then
    echo "ERROR: Could not determine the repository. Either pass OWNER/REPO as" >&2
    echo "       the first argument or run 'gh auth login' and try again." >&2
    exit 1
  fi
fi

echo "Configuring branch protection for: $REPO (branch: main)"
if [ "$ENFORCE_ADMINS" = "true" ]; then
  echo "enforce_admins: true  (admins must also pass status checks)"
else
  echo "enforce_admins: false (admins can bypass status checks)"
fi

# ---------------------------------------------------------------------------
# Build the checks JSON array from the canonical list
# ---------------------------------------------------------------------------
CHECKS_JSON=""
for CHECK in "${REQUIRED_CHECKS[@]}"; do
  # Escape any double-quotes in the check name (defensive — none exist today)
  ESCAPED="${CHECK//\"/\\\"}"
  if [ -n "$CHECKS_JSON" ]; then
    CHECKS_JSON+=$',\n'
  fi
  CHECKS_JSON+="      { \"context\": \"$ESCAPED\" }"
done

# ---------------------------------------------------------------------------
# Build the payload
# The GitHub REST API endpoint for branch protection is:
#   PUT /repos/{owner}/{repo}/branches/{branch}/protection
# It is a full-replace call, so every field must be supplied each time
# (making repeated calls idempotent as long as the payload stays the same).
# ---------------------------------------------------------------------------
PAYLOAD=$(cat <<JSON
{
  "required_status_checks": {
    "strict": true,
    "checks": [
$CHECKS_JSON
    ]
  },
  "enforce_admins": $ENFORCE_ADMINS,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
)

# ---------------------------------------------------------------------------
# Apply via gh api (wraps the GitHub REST API and handles auth transparently)
# ---------------------------------------------------------------------------
gh api \
  --method PUT \
  --header "Accept: application/vnd.github+json" \
  "/repos/$REPO/branches/main/protection" \
  --input - <<< "$PAYLOAD"

echo ""
echo "Branch protection rule applied successfully."
echo ""
echo "The following status checks are now required before merging into main:"
for CHECK in "${REQUIRED_CHECKS[@]}"; do
  echo "  • $CHECK"
done
echo ""
echo "Verify in the GitHub UI: Settings → Branches → Branch protection rules."
