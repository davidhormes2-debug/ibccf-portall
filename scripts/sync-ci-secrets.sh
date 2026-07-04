#!/usr/bin/env bash
# scripts/sync-ci-secrets.sh
#
# Auto-inserts missing secret entries so the three sources stay in sync:
#
#   1. smoke-test.yml  — env: mapping + secrets=() array in validate-secrets job
#   2. CI_SETUP.md     — Required secrets table (skeleton row)
#
# The script derives the authoritative list of required secrets from
# server/env.ts (validateEnv()) and from the smoke-test.yml array, then
# inserts any entries that are present in one source but absent in another.
#
# After inserting, it delegates to update-ci-secret-count.sh so the
# hardcoded counts are updated to reflect the new total.
#
# Usage (from the repository root):
#   bash scripts/sync-ci-secrets.sh
#
# The script is idempotent — running it when everything is already in sync
# makes no changes and exits 0.

set -euo pipefail

WORKFLOW_FILE="${WORKFLOW_FILE:-.github/workflows/smoke-test.yml}"
DOCS_FILE="${DOCS_FILE:-CI_SETUP.md}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-server/env.ts}"

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

if [ ! -f "$SERVER_ENV_FILE" ]; then
  echo "ERROR: $SERVER_ENV_FILE not found. Run this script from the repository root." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Shared exclusion lists (must stay in sync with check-ci-secrets-sync.sh)
# ---------------------------------------------------------------------------

# Non-secret process.env names referenced inside validateEnv() that should
# not be treated as workflow secrets.
#
# RULES FOR THIS BLOCK:
#   Each token MUST have a preceding comment line of the exact form:
#     # TOKEN — reason
#   The enforcement block below exits 1 if any token is missing its comment.
#   When adding a new token, add the comment line immediately above the
#   NON_SECRET_ENV_VARS= assignment AND add the token to the value.
#
# NODE_ENV — environment discriminator (production/development), not a secret
# PORT — network binding config, not a secret
# ALLOW_WEAK_SESSION_SECRET — local-development escape hatch, never set in CI
# ALLOW_WEAK_ADMIN_PASSWORD — local-development escape hatch, never set in CI
# ALLOW_WEAK_ADMIN_USERNAME — local-development escape hatch, never set in CI
#
NON_SECRET_ENV_VARS="NODE_ENV PORT ALLOW_WEAK_SESSION_SECRET ALLOW_WEAK_ADMIN_PASSWORD ALLOW_WEAK_ADMIN_USERNAME"

# Secrets validated by validateEnv() that are intentionally excluded from the
# workflow's secrets=() array because they are handled at a different layer.
# These vars still need docs rows if they appear in CI_SETUP.md — they just
# don't get auto-inserted into the workflow array.
# (Must mirror DOCS_NOT_STARTUP_VALIDATED in check-ci-secrets-sync.sh.)
#
# RULES FOR THIS BLOCK:
#   Each token MUST have a preceding comment line of the exact form:
#     # TOKEN — reason
#   The enforcement block below exits 1 if any token is missing its comment.
#   When adding a new token, add the comment line immediately above the
#   STARTUP_VALIDATED_EXCLUDES= assignment AND add the token to the value.
#
# DATABASE_URL — verified by the ORM/pg connection attempt at first query, not at process boot
# NEON_DATABASE_URL — verified by the ORM/pg connection attempt at first query, not at process boot
# DEPLOY_URL — used only by the CI smoke-test runner, never read by the application process
# SMTP_HOST — transactional email sends are best-effort; missing values degrade email delivery, not server boot
# SMTP_PORT — transactional email sends are best-effort; missing values degrade email delivery, not server boot
# SMTP_USER — transactional email sends are best-effort; missing values degrade email delivery, not server boot
# SMTP_PASSWORD — transactional email sends are best-effort; missing values degrade email delivery, not server boot
# SMTP_FROM_NAME — transactional email sends are best-effort; missing values degrade email delivery, not server boot
# SMTP_FROM_ADDRESS — transactional email sends are best-effort; missing values degrade email delivery, not server boot
# SMTP_REPLY_TO — transactional email sends are best-effort; missing values degrade email delivery, not server boot
#
STARTUP_VALIDATED_EXCLUDES="DATABASE_URL NEON_DATABASE_URL DEPLOY_URL SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_FROM_NAME SMTP_FROM_ADDRESS SMTP_REPLY_TO"

# ---------------------------------------------------------------------------
# Exclusion-list comment enforcement
#
# Every token in NON_SECRET_ENV_VARS and STARTUP_VALIDATED_EXCLUDES must have
# a preceding comment line of the form:  # TOKEN — reason
# This prevents exclusions from silently losing their explanations over time.
# ---------------------------------------------------------------------------
_sync_comment_violations=""
_this_file="${BASH_SOURCE[0]}"

for _ctoken in $NON_SECRET_ENV_VARS $STARTUP_VALIDATED_EXCLUDES; do
  if ! grep -qE "^# ${_ctoken}[[:space:]]*—" "$_this_file"; then
    _sync_comment_violations="${_sync_comment_violations}${_ctoken}"$'\n'
  fi
done
_sync_comment_violations=$(echo "$_sync_comment_violations" | grep -v '^$' || true)

if [ -n "$_sync_comment_violations" ]; then
  echo "ERROR: The following exclusion tokens are missing a '# TOKEN — reason' comment" >&2
  echo "       in $0:" >&2
  echo "$_sync_comment_violations" | sed 's/^/  /' >&2
  echo "" >&2
  echo "  Fix: add a comment of the form '# TOKEN — reason' immediately before" >&2
  echo "  the NON_SECRET_ENV_VARS or STARTUP_VALIDATED_EXCLUDES assignment for" >&2
  echo "  each listed token." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Extract secrets from server/env.ts (validateEnv() body)
# ---------------------------------------------------------------------------
server_env_secrets_raw=$(awk '
  /export function validateEnv/ { found=1; depth=0 }
  found {
    for (i=1; i<=length($0); i++) {
      c = substr($0, i, 1)
      if (c == "{") depth++
      if (c == "}") { depth--; if (depth == 0) { found=0; break } }
    }
    print
  }
' "$SERVER_ENV_FILE" \
  | grep -oE 'process\.env\.[A-Z][A-Z0-9_]+' \
  | grep -oE '[A-Z][A-Z0-9_]+$')

if [ -z "$server_env_secrets_raw" ]; then
  echo "ERROR: Could not extract any process.env references from validateEnv() in $SERVER_ENV_FILE." >&2
  exit 1
fi

# Filter out known non-secret config vars and ALLOW_* escape hatches.
server_env_secrets=""
for var in $server_env_secrets_raw; do
  skip=0
  for excluded in $NON_SECRET_ENV_VARS; do
    if [ "$var" = "$excluded" ]; then skip=1; break; fi
  done
  if echo "$var" | grep -qE '^ALLOW_'; then skip=1; fi
  # Also skip vars in the startup-excluded list — they are handled
  # outside validateEnv() and are already in the workflow via other means.
  for excluded in $STARTUP_VALIDATED_EXCLUDES; do
    if [ "$var" = "$excluded" ]; then skip=1; break; fi
  done
  if [ "$skip" -eq 0 ]; then
    server_env_secrets="${server_env_secrets}${var}"$'\n'
  fi
done
server_env_secrets=$(echo "$server_env_secrets" | grep -v '^$' | sort -u)

# ---------------------------------------------------------------------------
# Extract secrets currently in smoke-test.yml secrets=() array
# ---------------------------------------------------------------------------
workflow_secrets=$(awk '
  /secrets=\(/ { found=1 }
  found { print }
  found && /\)/ { exit }
' "$WORKFLOW_FILE" \
  | grep -oE '[A-Z][A-Z0-9_]{2,}' \
  | sort -u)

if [ -z "$workflow_secrets" ]; then
  echo "ERROR: Could not extract the secrets array from $WORKFLOW_FILE." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Extract secrets from CI_SETUP.md Required secrets table
# ---------------------------------------------------------------------------
docs_secrets=$(awk '
  /^## Required secrets/ { found=1; next }
  found && /^## /        { exit }
  found && /^\| *`[A-Z]/ {
    if (match($0, /`[A-Z][A-Z0-9_]+`/)) {
      print substr($0, RSTART + 1, RLENGTH - 2)
    }
  }
' "$DOCS_FILE" | sort -u)

if [ -z "$docs_secrets" ]; then
  echo "ERROR: Could not extract secrets from the 'Required secrets' table in $DOCS_FILE." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Compute missing entries
# ---------------------------------------------------------------------------
# Secrets validated at startup but not yet in the workflow array
missing_from_workflow=$(comm -23 \
  <(echo "$server_env_secrets") \
  <(echo "$workflow_secrets") || true)

# Secrets in (or about to be in) the workflow but not yet in the docs table.
# We compute this against an augmented workflow list that includes
# missing_from_workflow so newly-added secrets also get docs rows.
augmented_workflow=$(printf '%s\n%s' "$workflow_secrets" "$missing_from_workflow" \
  | sort -u | grep -v '^$')
missing_from_docs=$(comm -23 \
  <(echo "$augmented_workflow") \
  <(echo "$docs_secrets") || true)

# ---------------------------------------------------------------------------
# Report what was found
# ---------------------------------------------------------------------------
echo "Secrets validated at startup in $SERVER_ENV_FILE (after filtering):"
echo "$server_env_secrets" | sed 's/^/  /'
echo ""
echo "Secrets currently in $WORKFLOW_FILE:"
echo "$workflow_secrets" | sed 's/^/  /'
echo ""
echo "Secrets currently in $DOCS_FILE:"
echo "$docs_secrets" | sed 's/^/  /'
echo ""

if [ -z "$missing_from_workflow" ] && [ -z "$missing_from_docs" ]; then
  echo "All sources are already in sync — no insertions needed."
  # Still run count-fix in case counts drifted independently.
  bash "$(dirname "$0")/update-ci-secret-count.sh"
  exit 0
fi

if [ -n "$missing_from_workflow" ]; then
  echo "Secrets to INSERT into $WORKFLOW_FILE:"
  echo "$missing_from_workflow" | sed 's/^/  /'
  echo ""
fi
if [ -n "$missing_from_docs" ]; then
  echo "Secrets to INSERT skeleton rows for in $DOCS_FILE:"
  echo "$missing_from_docs" | sed 's/^/  /'
  echo ""
fi

# ---------------------------------------------------------------------------
# Insert missing secrets into smoke-test.yml
#
# Two locations inside the validate-secrets job must be updated together:
#
#   A) The `env:` YAML block — adds a mapping so the secret value is
#      available as a shell variable inside the `run:` step.
#
#   B) The `secrets=(...)` bash array — adds the name so the presence
#      check and the step-summary table cover the new secret.
# ---------------------------------------------------------------------------
workflow_changed=0

for secret in $missing_from_workflow; do
  env_line="          ${secret}: \${{ secrets.${secret} }}"

  # -- A: env: block --
  if grep -qF "$env_line" "$WORKFLOW_FILE"; then
    echo "  env: mapping for $secret already present — skipping."
  else
    # Insert after the last "          UPPERCASE: ${{ secrets.UPPERCASE }}" line
    # INSIDE the validate-secrets step's env: block only.
    # We track state: enter the target step on its "name:" line, enter the
    # env: sub-block, record the last matching mapping line, and stop
    # tracking as soon as we hit the "run:" that follows the env: block.
    awk -v new="$env_line" '
      /name: Check all required secrets are present/ { in_step=1 }
      in_step && /^        env:/                     { in_env=1 }
      in_step && in_env &&
        /^          [A-Z][A-Z0-9_]+: \$\{\{ secrets\.[A-Z][A-Z0-9_]+ \}\}$/ { last=NR }
      in_step && in_env && /^        run:/            { in_env=0; in_step=0 }
      { lines[NR] = $0 }
      END {
        for (i = 1; i <= NR; i++) {
          print lines[i]
          if (i == last) print new
        }
      }
    ' "$WORKFLOW_FILE" > "${WORKFLOW_FILE}.sync_tmp" \
      && mv "${WORKFLOW_FILE}.sync_tmp" "$WORKFLOW_FILE"
    echo "  Inserted env: mapping for $secret into $WORKFLOW_FILE."
    workflow_changed=1
  fi

  # -- B: secrets=() bash array --
  # Check whether the name already appears inside the secrets=() block.
  array_block=$(awk '/secrets=\(/{found=1} found{print} found && /\)/{exit}' "$WORKFLOW_FILE")
  if echo "$array_block" | grep -qE "\b${secret}\b"; then
    echo "  secrets=() entry for $secret already present — skipping."
  else
    # Append the new name just before the closing ) of the array.
    awk -v new="$secret" '
      /secrets=\(/ { in_arr = 1 }
      in_arr && /\)/ {
        sub(/\)[ \t]*$/, " " new ")")
        in_arr = 0
      }
      { print }
    ' "$WORKFLOW_FILE" > "${WORKFLOW_FILE}.sync_tmp" \
      && mv "${WORKFLOW_FILE}.sync_tmp" "$WORKFLOW_FILE"
    echo "  Inserted $secret into secrets=() array in $WORKFLOW_FILE."
    workflow_changed=1
  fi
done

# ---------------------------------------------------------------------------
# Insert skeleton rows into CI_SETUP.md for secrets missing from the table
# ---------------------------------------------------------------------------
docs_changed=0

for secret in $missing_from_docs; do
  # Check if already present (idempotency guard).
  if awk '
    /^## Required secrets/ { found=1; next }
    found && /^## / { exit }
    found && /^\| *`[A-Z]/ {
      if (match($0, /`[A-Z][A-Z0-9_]+`/)) {
        print substr($0, RSTART+1, RLENGTH-2)
      }
    }
  ' "$DOCS_FILE" | grep -qx "$secret"; then
    echo "  Docs row for $secret already present — skipping."
    continue
  fi

  skeleton_row="| \`${secret}\` | _TODO: add description_ | \`placeholder\` | _TODO: where to obtain_ |"

  # Insert after the last table data row (| \`UPPER...`) inside ## Required secrets.
  awk -v new="$skeleton_row" '
    /^## Required secrets/ { in_sec = 1 }
    in_sec && /^## / && !/^## Required secrets/ { in_sec = 0 }
    in_sec && /^\| *`[A-Z]/ { last = NR }
    { lines[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        print lines[i]
        if (i == last) print new
      }
    }
  ' "$DOCS_FILE" > "${DOCS_FILE}.sync_tmp" \
    && mv "${DOCS_FILE}.sync_tmp" "$DOCS_FILE"

  echo "  Inserted skeleton row for $secret into $DOCS_FILE."
  docs_changed=1
done

# ---------------------------------------------------------------------------
# Fix hardcoded counts now that entries have been added
# ---------------------------------------------------------------------------
bash "$(dirname "$0")/update-ci-secret-count.sh"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
if [ "$workflow_changed" -eq 0 ] && [ "$docs_changed" -eq 0 ]; then
  echo "No insertions were required — all sources were already in sync."
else
  echo "Done. Missing entries have been inserted."
  if [ "$workflow_changed" -eq 1 ]; then
    echo "  Modified: $WORKFLOW_FILE (env: mapping + secrets=() entry)"
  fi
  if [ "$docs_changed" -eq 1 ]; then
    echo "  Modified: $DOCS_FILE (skeleton row — fill in Description, Example value, and Where to obtain)"
  fi
fi
