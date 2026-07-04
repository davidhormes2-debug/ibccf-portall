#!/bin/bash
set -e
# pipefail is required so run_guarded() below sees the exit code of the
# guarded command itself, not of the trailing `tee` in its pipeline (which
# always succeeds).
set -o pipefail

echo "=== Post-merge setup ==="

echo "Installing dependencies..."
npm install --legacy-peer-deps

# ---------------------------------------------------------------------------
# run_guarded <step-name> <command...>
#
# Runs a schema-safety step, tee'ing its output to both this log and a temp
# file. If the step fails, fires an out-of-band alert (Slack/email) via
# scripts/notify-post-merge-failure.ts BEFORE aborting the pipeline (`set -e`
# would otherwise exit the script with no chance to notify). Only used for
# steps whose silent failure would leave the DB schema out of sync
# (db-migrate.sh, check-schema-drift.ts) — see docs/ci-checks.md.
# ---------------------------------------------------------------------------
run_guarded() {
  local step_name="$1"
  shift
  local output_file
  output_file="$(mktemp)"

  if "$@" 2>&1 | tee "$output_file"; then
    rm -f "$output_file"
    return 0
  fi

  local exit_code=$?
  echo "=== post-merge: '${step_name}' FAILED (exit ${exit_code}) — sending alert ==="
  npx tsx scripts/notify-post-merge-failure.ts \
    --step "${step_name}" \
    --exit-code "${exit_code}" \
    --output-file "${output_file}" || true
  rm -f "${output_file}"
  exit "${exit_code}"
}

echo "Applying idempotent schema migrations..."
run_guarded "db-migrate.sh" bash scripts/db-migrate.sh

echo "Checking for column type drift..."
run_guarded "check-schema-drift.ts" npx tsx scripts/check-schema-drift.ts

echo "Checking db-migrate.sh cast coverage..."
npx tsx scripts/check-migrate-coverage.ts

echo "Syncing database schema..."
npm run db:push -- --force

echo "=== Post-merge setup complete ==="
