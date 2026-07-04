#!/usr/bin/env bash
# Canonical mapping from failure_reason token to alert strings.
# Called by BOTH the "Prepare notification context" step in
# .github/workflows/branch-protection.yml (the notify job) AND by the unit
# tests in scripts/__tests__/alert-failure-reason-mapping.test.ts.
#
# Usage: bash scripts/map-alert-reason.sh <failure_reason>
# Output: three key=value lines — short=..., detail=..., fix=...
#
# Edit this file to change alert text; the workflow sources it automatically.

set -euo pipefail

REASON="${1:-}"
CHECKS_LIST=$(paste -sd ', ' scripts/required-checks.txt)

case "$REASON" in
  *enforce_admins_disabled*required_checks_missing*|*required_checks_missing*enforce_admins_disabled*)
    SHORT="Required status checks are missing AND enforce_admins is disabled."
    DETAIL="Both issues must be fixed: one or more required status checks ($CHECKS_LIST) are absent from the rule, AND the enforce_admins setting is off — meaning admins can merge without passing required checks."
    FIX="bash scripts/setup-github-protection.sh --enforce-admins"
    ;;
  *enforce_admins_disabled*)
    SHORT="enforce_admins is disabled — admins can bypass required checks."
    DETAIL="The required status checks are present, but enforce_admins is turned off. This means repository admins can merge pull requests without passing the required gates."
    FIX="bash scripts/setup-github-protection.sh --enforce-admins"
    ;;
  *required_checks_missing*|*no_protection_rule*)
    SHORT="Required status checks are missing or the protection rule does not exist."
    DETAIL="The branch protection rule for \`main\` is missing or no longer lists all required status checks ($CHECKS_LIST)."
    FIX="bash scripts/setup-github-protection.sh"
    ;;
  *)
    SHORT="The branch protection rule for \`main\` is missing, incomplete, or has enforce_admins disabled."
    DETAIL="Check the failing run log for the exact cause."
    FIX="bash scripts/setup-github-protection.sh --enforce-admins"
    ;;
esac

printf 'short=%s\n' "$SHORT"
printf 'detail=%s\n' "$DETAIL"
printf 'fix=%s\n' "$FIX"
