#!/usr/bin/env bash
# scripts/check-ci-secrets-sync.sh
#
# Verifies that:
#   1. The required secrets listed in CI_SETUP.md match exactly the secrets
#      validated by the smoke-test workflow's validate-secrets job.
#   2. Every secret that server/env.ts validates at startup (via validateEnv())
#      is also present in the smoke-test workflow's secrets=() array.
#   3. The hardcoded secret counts in CI_SETUP.md and smoke-test.yml equal
#      the actual number of entries in the workflow's secrets=() array.
#   4. Every secret in CI_SETUP.md's Required Secrets table is either validated
#      by validateEnv() in server/env.ts OR appears in the known non-startup-
#      validated exclusion list (DOCS_NOT_STARTUP_VALIDATED below).  This
#      catches secrets that were documented and added to the workflow but whose
#      validateEnv() check was accidentally omitted, which would give operators
#      false confidence that a missing value is caught before the server starts.
#
# Exits 0 if all four sets are consistent, 1 if any diverge (with a clear diff).
#
# Usage (from the repository root):
#   bash scripts/check-ci-secrets-sync.sh
#
# This script is run automatically by .github/workflows/ci-secrets-sync.yml on
# every push or pull request that touches CI_SETUP.md, smoke-test.yml, or
# server/env.ts. Run it locally before opening a PR if you change any of
# those files.

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
# Extract secrets from smoke-test.yml
#
# The validate-secrets job contains a multi-line bash array:
#
#   secrets=(DATABASE_URL SESSION_SECRET SMTP_HOST SMTP_PORT SMTP_USER \
#            SMTP_PASSWORD SMTP_FROM_NAME SMTP_FROM_ADDRESS SMTP_REPLY_TO \
#            ADMIN_USERNAME ADMIN_PASSWORD DEPLOY_URL)
#
# We grab every contiguous block of UPPER_SNAKE_CASE tokens from the lines
# between `secrets=(` and the closing `)` in that job's run block.
# ---------------------------------------------------------------------------
workflow_secrets_raw=$(awk '
  /secrets=\(/ { found=1 }
  found { print }
  found && /\)/ { exit }
' "$WORKFLOW_FILE")

workflow_secrets=$(echo "$workflow_secrets_raw" \
  | grep -oE '[A-Z][A-Z0-9_]{2,}' \
  | sort -u)

if [ -z "$workflow_secrets" ]; then
  echo "ERROR: Could not extract the secrets array from $WORKFLOW_FILE." >&2
  echo "       Expected a multi-line 'secrets=(...)' bash array in the" >&2
  echo "       validate-secrets job's 'run' block." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Extract secrets from CI_SETUP.md
#
# We parse only the "## Required secrets" section (up to the next ##-heading).
# Each data row in the Markdown table looks like:
#
#   | `SECRET_NAME` | description | example | where to obtain |
#
# We pull out the back-tick-quoted name from column 1 of each data row.
# ---------------------------------------------------------------------------
docs_secrets=$(awk '
  /^## Required secrets/ { found=1; next }
  found && /^## /        { exit }
  found && /^\| *`[A-Z]/ {
    # match the first back-tick-quoted token on the line
    if (match($0, /`[A-Z][A-Z0-9_]+`/)) {
      print substr($0, RSTART + 1, RLENGTH - 2)
    }
  }
' "$DOCS_FILE" | sort -u)

if [ -z "$docs_secrets" ]; then
  echo "ERROR: Could not extract any secrets from the 'Required secrets' table in $DOCS_FILE." >&2
  echo "       Expected table rows of the form: | \`SECRET_NAME\` | ..." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Extract secrets from server/env.ts (validateEnv() body)
#
# We extract the body of the exported validateEnv() function, then pull out
# every process.env.VARNAME reference from it.  Non-secret runtime config vars
# are excluded via a blocklist:
#
#   NODE_ENV            — environment discriminator, not a secret
#   ALLOW_WEAK_*        — local-development escape hatches, not secrets
#   PORT                — network binding config, not a secret
#
# This catches the case where a new required secret is added to validateEnv()
# but its name is not yet listed in the workflow's secrets=() array.
# ---------------------------------------------------------------------------

# Non-secret process.env names referenced inside validateEnv() that should
# not be treated as workflow secrets.  Extend this list if new non-secret
# config vars are added to validateEnv() in the future.
#
# RULES FOR THIS BLOCK:
#   1. Each token in NON_SECRET_ENV_VARS MUST have a preceding comment
#      line of the exact form:  # TOKEN — reason
#      (one token per line, an em-dash or " — " separator, a non-empty reason).
#   2. Pass F below enforces this at script execution time — it exits 1 if any
#      token in the built-in default list is missing its comment line.
#   3. When adding a new token, add the comment line immediately above this
#      block's closing NON_SECRET_ENV_VARS= assignment AND add the token
#      to the space-separated default value.
#
# NODE_ENV — environment discriminator, not a secret
# PORT — network binding config, not a secret
# ALLOW_WEAK_SESSION_SECRET — local-development escape hatch, not a secret
# ALLOW_WEAK_ADMIN_PASSWORD — local-development escape hatch, not a secret
# ALLOW_WEAK_ADMIN_USERNAME — local-development escape hatch, not a secret
#
# The default value can be overridden via the NON_SECRET_ENV_VARS
# environment variable, which is used exclusively by the test suite to inject
# a fresh dummy exclusion without modifying this file.
NON_SECRET_ENV_VARS="${NON_SECRET_ENV_VARS:-NODE_ENV PORT ALLOW_WEAK_SESSION_SECRET ALLOW_WEAK_ADMIN_PASSWORD ALLOW_WEAK_ADMIN_USERNAME}"

# File whose NON_SECRET_ENV_VARS block is linted by Pass F.
# Defaults to this script itself; overridden by the test suite to point at a
# fixture file so the lint pass can be tested without modifying this file.
NON_SECRET_ENV_VARS_FILE="${NON_SECRET_ENV_VARS_FILE:-${BASH_SOURCE[0]}}"

# Secrets documented in CI_SETUP.md that are intentionally NOT validated by
# validateEnv() at server startup because the server handles their absence
# gracefully or they are checked at a different layer.
#
# RULES FOR THIS BLOCK:
#   1. Each token in DOCS_NOT_STARTUP_VALIDATED MUST have a preceding comment
#      line of the exact form:  # TOKEN — reason
#      (one token per line, an em-dash or " — " separator, a non-empty reason).
#   2. Pass E below enforces this at script execution time — it exits 1 if any
#      token in the built-in default list is missing its comment line.
#   3. When adding a new token, add the comment line immediately above this
#      block's closing DOCS_NOT_STARTUP_VALIDATED= assignment AND add the token
#      to the space-separated default value.
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
# The default value can be overridden via the DOCS_NOT_STARTUP_VALIDATED
# environment variable, which is used exclusively by the test suite to inject
# a fresh dummy exclusion without modifying this file.
DOCS_NOT_STARTUP_VALIDATED="${DOCS_NOT_STARTUP_VALIDATED:-DATABASE_URL NEON_DATABASE_URL DEPLOY_URL SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_FROM_NAME SMTP_FROM_ADDRESS SMTP_REPLY_TO}"

# File whose DOCS_NOT_STARTUP_VALIDATED block is linted by Pass E.
# Defaults to this script itself; overridden by the test suite to point at a
# fixture file so the lint pass can be tested without modifying this file.
EXCLUSION_LIST_FILE="${EXCLUSION_LIST_FILE:-${BASH_SOURCE[0]}}"

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
  echo "       Expected at least one 'process.env.VAR_NAME' reference inside the" >&2
  echo "       'export function validateEnv' body." >&2
  exit 1
fi

# Filter out known non-secret config vars
server_env_secrets=""
for var in $server_env_secrets_raw; do
  skip=0
  for excluded in $NON_SECRET_ENV_VARS; do
    if [ "$var" = "$excluded" ]; then
      skip=1
      break
    fi
  done
  # Also exclude any ALLOW_WEAK_* pattern not individually listed above
  if echo "$var" | grep -qE '^ALLOW_'; then
    skip=1
  fi
  if [ "$skip" -eq 0 ]; then
    server_env_secrets="${server_env_secrets}${var}"$'\n'
  fi
done

server_env_secrets=$(echo "$server_env_secrets" | grep -v '^$' | sort -u)

if [ -z "$server_env_secrets" ]; then
  echo "ERROR: After filtering non-secret vars, no secrets remain from validateEnv() in $SERVER_ENV_FILE." >&2
  echo "       Check the NON_SECRET_ENV_VARS exclusion list in this script." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Report what was found
# ---------------------------------------------------------------------------
echo "Secrets in $WORKFLOW_FILE (validate-secrets job):"
echo "$workflow_secrets" | sed 's/^/  /'
echo ""
echo "Secrets in $DOCS_FILE (## Required secrets table):"
echo "$docs_secrets" | sed 's/^/  /'
echo ""
echo "Secrets validated at startup in $SERVER_ENV_FILE (validateEnv()):"
echo "$server_env_secrets" | sed 's/^/  /'
echo ""

# ---------------------------------------------------------------------------
# Compare workflow vs docs
# ---------------------------------------------------------------------------
only_in_workflow=$(comm -23 <(echo "$workflow_secrets") <(echo "$docs_secrets") || true)
only_in_docs=$(comm -13 <(echo "$workflow_secrets") <(echo "$docs_secrets") || true)

# ---------------------------------------------------------------------------
# Compare server startup validation vs workflow
#
# Every secret that validateEnv() checks must appear in the workflow so CI
# can confirm it is present before the smoke test runs against the deployment.
# ---------------------------------------------------------------------------
only_in_server=$(comm -23 <(echo "$server_env_secrets") <(echo "$workflow_secrets") || true)

# ---------------------------------------------------------------------------
# Compare docs vs server startup validation  (the "inverse gap" check)
#
# Every secret documented in CI_SETUP.md must EITHER be validated by
# validateEnv() OR appear in DOCS_NOT_STARTUP_VALIDATED (secrets that are
# legitimately handled outside of server startup — see the comment above).
# Anything else was documented and added to the workflow but its startup
# check was accidentally omitted, giving operators false confidence.
# ---------------------------------------------------------------------------
only_in_docs_not_server=""
for _var in $docs_secrets; do
  # Already validated by validateEnv() — fine
  if echo "$server_env_secrets" | grep -qx "$_var"; then
    continue
  fi
  # In the known non-startup-validated exclusion list — intentional
  _skip=0
  for _excluded in $DOCS_NOT_STARTUP_VALIDATED; do
    if [ "$_var" = "$_excluded" ]; then
      _skip=1
      break
    fi
  done
  if [ "$_skip" -eq 0 ]; then
    only_in_docs_not_server="${only_in_docs_not_server}${_var}"$'\n'
  fi
done
only_in_docs_not_server=$(echo "$only_in_docs_not_server" | grep -v '^$' || true)

# ---------------------------------------------------------------------------
# Count check — the hardcoded totals in CI_SETUP.md and smoke-test.yml must
# equal the actual number of entries in the workflow's secrets array.
# ---------------------------------------------------------------------------
actual_count=$(echo "$workflow_secrets" | grep -c '[A-Z]')

# Extract the count from CI_SETUP.md near "GitHub repository secrets".
# The text reads: requires **12 GitHub repository secrets** (whole phrase bolded).
docs_count=$(grep -oE '[0-9]+ GitHub repository secrets' "$DOCS_FILE" | grep -oE '^[0-9]+' | head -1)
if [ -z "$docs_count" ]; then
  echo "ERROR: Could not find a count near 'GitHub repository secrets' in $DOCS_FILE." >&2
  echo "       Expected text like: requires **12 GitHub repository secrets**" >&2
  exit 1
fi

# Extract the count from smoke-test.yml echo line: "All 12 required secrets are present."
workflow_count_raw=$(grep -oE 'All [0-9]+ required secrets' "$WORKFLOW_FILE" | head -1)
if [ -z "$workflow_count_raw" ]; then
  echo "ERROR: Could not find a count line in $WORKFLOW_FILE." >&2
  echo "       Expected text like: All 12 required secrets are present." >&2
  exit 1
fi
workflow_count=$(echo "$workflow_count_raw" | grep -oE '[0-9]+')

echo "Hardcoded count in $DOCS_FILE:     $docs_count"
echo "Hardcoded count in $WORKFLOW_FILE: $workflow_count"
echo "Actual secret list length:         $actual_count"
echo ""

# ---------------------------------------------------------------------------
# Pass E — DOCS_NOT_STARTUP_VALIDATED comment enforcement
#
# Every token in the built-in default value of DOCS_NOT_STARTUP_VALIDATED must
# have a preceding comment line of the form:
#
#   # TOKEN — reason why startup validation is skipped
#
# This is enforced by reading EXCLUSION_LIST_FILE (defaults to this script
# itself) and checking for a matching comment for each token.  The check is
# skipped when the env var DOCS_NOT_STARTUP_VALIDATED is externally overridden
# (i.e. the test suite is injecting a transient dummy exclusion list that does
# not need to be documented in this file).
# ---------------------------------------------------------------------------
_pass_e_violations=""

# Only lint the file when the env var was NOT overridden externally.
# When the test suite overrides DOCS_NOT_STARTUP_VALIDATED, it is responsible
# for providing its own EXCLUSION_LIST_FILE fixture.
_builtin_list=$(grep 'DOCS_NOT_STARTUP_VALIDATED="\${' "$EXCLUSION_LIST_FILE" \
  | sed 's/.*:-\([^}]*\).*/\1/' | head -1)

if [ -n "$_builtin_list" ]; then
  for _etoken in $_builtin_list; do
    if ! grep -qE "^# ${_etoken}[[:space:]]*—" "$EXCLUSION_LIST_FILE"; then
      _pass_e_violations="${_pass_e_violations}${_etoken}"$'\n'
    fi
  done
  _pass_e_violations=$(echo "$_pass_e_violations" | grep -v '^$' || true)
fi

# ---------------------------------------------------------------------------
# Pass F — NON_SECRET_ENV_VARS comment enforcement
#
# Every token in the built-in default value of NON_SECRET_ENV_VARS must
# have a preceding comment line of the form:
#
#   # TOKEN — reason why it is not a secret
#
# This is enforced by reading NON_SECRET_ENV_VARS_FILE (defaults to this
# script itself) and checking for a matching comment for each token.
# ---------------------------------------------------------------------------
_pass_f_violations=""

_builtin_non_secret_list=$(grep 'NON_SECRET_ENV_VARS="\${' "$NON_SECRET_ENV_VARS_FILE" \
  | sed 's/.*:-\([^}]*\).*/\1/' | head -1)

if [ -n "$_builtin_non_secret_list" ]; then
  for _nstoken in $_builtin_non_secret_list; do
    if ! grep -qE "^# ${_nstoken}[[:space:]]*—" "$NON_SECRET_ENV_VARS_FILE"; then
      _pass_f_violations="${_pass_f_violations}${_nstoken}"$'\n'
    fi
  done
  _pass_f_violations=$(echo "$_pass_f_violations" | grep -v '^$' || true)
fi

# ---------------------------------------------------------------------------
# TODO placeholder check — fail if any Required secrets table row still has
# a _TODO: placeholder in any column.  The sync script inserts skeleton rows;
# the developer must fill them in before a PR is review-ready.
# ---------------------------------------------------------------------------
todo_rows=$(awk '
  /^## Required secrets/ { found=1; next }
  found && /^## /        { exit }
  found && /^\|/ && /_TODO:/ { print }
' "$DOCS_FILE")

# ---------------------------------------------------------------------------
# Summarise results
# ---------------------------------------------------------------------------
drift_found=0

if [ -z "$only_in_workflow" ] && [ -z "$only_in_docs" ]; then
  echo "OK: $WORKFLOW_FILE and $DOCS_FILE list identical secrets — no drift."
else
  drift_found=1
fi

if [ -z "$only_in_server" ]; then
  echo "OK: All startup-validated secrets in $SERVER_ENV_FILE are present in $WORKFLOW_FILE — no drift."
else
  drift_found=1
fi

if [ -z "$only_in_docs_not_server" ]; then
  echo "OK: All documented secrets in $DOCS_FILE are either validated by validateEnv() in $SERVER_ENV_FILE or are in the known non-startup-validated exclusion list — no drift."
else
  drift_found=1
fi

count_ok=true

if [ "$docs_count" != "$actual_count" ]; then
  echo "COUNT MISMATCH: $DOCS_FILE says $docs_count secrets but the workflow array has $actual_count." >&2
  echo "  Fix: update the bold number on the first line of $DOCS_FILE to **${actual_count}**." >&2
  echo "" >&2
  count_ok=false
  drift_found=1
fi

if [ "$workflow_count" != "$actual_count" ]; then
  echo "COUNT MISMATCH: $WORKFLOW_FILE echo says $workflow_count secrets but the array has $actual_count." >&2
  echo "  Fix: update the 'All N required secrets are present.' echo in the" >&2
  echo "  validate-secrets job of $WORKFLOW_FILE to use $actual_count." >&2
  echo "" >&2
  count_ok=false
  drift_found=1
fi

if [ "$count_ok" = "true" ]; then
  echo "OK: Hardcoded counts in $DOCS_FILE and $WORKFLOW_FILE match the actual secret list length."
fi

if [ -z "$_pass_e_violations" ]; then
  echo "OK: All tokens in DOCS_NOT_STARTUP_VALIDATED have a '# TOKEN — reason' comment in $EXCLUSION_LIST_FILE."
else
  drift_found=1
fi

if [ -z "$_pass_f_violations" ]; then
  echo "OK: All tokens in NON_SECRET_ENV_VARS have a '# TOKEN — reason' comment in $NON_SECRET_ENV_VARS_FILE."
else
  drift_found=1
fi

if [ -z "$todo_rows" ]; then
  echo "OK: No _TODO: placeholders found in the Required secrets table in $DOCS_FILE."
else
  drift_found=1
fi

if [ "$drift_found" -eq 0 ]; then
  echo ""
  echo "All checks passed — no secrets drift detected."
  exit 0
fi

# ---------------------------------------------------------------------------
# Report drift
# ---------------------------------------------------------------------------
echo "" >&2
echo "DRIFT DETECTED — secrets are out of sync across one or more sources." >&2
echo "" >&2

if [ -n "$only_in_workflow" ]; then
  echo "Secrets present in $WORKFLOW_FILE but MISSING from $DOCS_FILE:" >&2
  echo "$only_in_workflow" | sed 's/^/  /' >&2
  echo "" >&2
  echo "  Fix: add a row for each missing secret to the '## Required secrets'" >&2
  echo "  table in $DOCS_FILE, filling in the Description, Example value," >&2
  echo "  and 'Where to obtain' columns." >&2
  echo "" >&2
fi

if [ -n "$only_in_docs" ]; then
  echo "Secrets documented in $DOCS_FILE but MISSING from $WORKFLOW_FILE:" >&2
  echo "$only_in_docs" | sed 's/^/  /' >&2
  echo "" >&2
  echo "  Fix: either add the secret to the secrets=(...) array in the" >&2
  echo "  validate-secrets job in $WORKFLOW_FILE, or remove the stale row" >&2
  echo "  from $DOCS_FILE." >&2
  echo "" >&2
fi

if [ -n "$only_in_server" ]; then
  echo "Secrets validated by validateEnv() in $SERVER_ENV_FILE but MISSING from $WORKFLOW_FILE:" >&2
  echo "$only_in_server" | sed 's/^/  /' >&2
  echo "" >&2
  echo "  Fix: add each missing name to the secrets=(...) array in the" >&2
  echo "  validate-secrets job in $WORKFLOW_FILE so CI confirms the secret" >&2
  echo "  is present before the smoke test runs. Also add a row for it in" >&2
  echo "  the '## Required secrets' table in $DOCS_FILE." >&2
  echo "" >&2
fi

if [ -n "$only_in_docs_not_server" ]; then
  echo "Secrets documented in $DOCS_FILE but NOT validated by validateEnv() in $SERVER_ENV_FILE:" >&2
  echo "$only_in_docs_not_server" | sed 's/^/  /' >&2
  echo "" >&2
  echo "  These secrets are present in the workflow and the docs, so operators" >&2
  echo "  expect them to be checked — but validateEnv() never references them." >&2
  echo "  A missing value will not be caught at server startup." >&2
  echo "" >&2
  echo "  Fix (choose one):" >&2
  echo "    A) Add a process.env.<NAME> check inside validateEnv() in" >&2
  echo "       $SERVER_ENV_FILE so the server fails fast when the secret" >&2
  echo "       is absent or weak." >&2
  echo "    B) If the server handles the absence gracefully (e.g. best-effort" >&2
  echo "       email, ORM-level DB check), add the name to the" >&2
  echo "       DOCS_NOT_STARTUP_VALIDATED exclusion list in this script" >&2
  echo "       with a comment explaining why startup validation is not needed." >&2
  echo "" >&2
fi

if [ -n "$_pass_e_violations" ]; then
  echo "EXCLUSION COMMENT MISSING — every token in DOCS_NOT_STARTUP_VALIDATED must" >&2
  echo "have a comment line of the form '# TOKEN — reason' in $EXCLUSION_LIST_FILE:" >&2
  echo "$_pass_e_violations" | sed 's/^/  /' >&2
  echo "" >&2
  echo "  Fix: add a comment immediately before the DOCS_NOT_STARTUP_VALIDATED" >&2
  echo "  assignment in $EXCLUSION_LIST_FILE for each listed token, following" >&2
  echo "  the format:  # TOKEN — reason why startup validation is skipped" >&2
  echo "" >&2
fi

if [ -n "$_pass_f_violations" ]; then
  echo "NON_SECRET COMMENT MISSING — every token in NON_SECRET_ENV_VARS must" >&2
  echo "have a comment line of the form '# TOKEN — reason' in $NON_SECRET_ENV_VARS_FILE:" >&2
  echo "$_pass_f_violations" | sed 's/^/  /' >&2
  echo "" >&2
  echo "  Fix: add a comment immediately before the NON_SECRET_ENV_VARS" >&2
  echo "  assignment in $NON_SECRET_ENV_VARS_FILE for each listed token, following" >&2
  echo "  the format:  # TOKEN — reason why it is not a secret" >&2
  echo "" >&2
fi

if [ -n "$todo_rows" ]; then
  echo "TODO PLACEHOLDERS FOUND in $DOCS_FILE (## Required secrets table):" >&2
  echo "$todo_rows" | sed 's/^/  /' >&2
  echo "" >&2
  echo "  The sync script inserted skeleton rows for one or more secrets." >&2
  echo "  Fill in the Description, Example value, and Where to obtain" >&2
  echo "  columns for every row that still contains '_TODO:' before opening" >&2
  echo "  your PR." >&2
  echo "" >&2
fi

echo "See CI_SETUP.md — 'Keeping secrets in sync' — for the update checklist." >&2
exit 1
