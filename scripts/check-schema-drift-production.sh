#!/bin/bash
# scripts/check-schema-drift-production.sh
#
# Read-only pre-publish drift check against PRODUCTION.
#
# Why this exists (see Task: Pre-publish production migration safeguard):
#   Replit's Publish flow auto-diffs shared/schema.ts against the production
#   database and generates its own migration SQL. That auto-generated SQL
#   uses a plain `ALTER TABLE ... TYPE ...` with no `USING` clause, so any
#   column whose type changed in a way Postgres cannot implicitly cast (e.g.
#   text -> integer/boolean) makes Publish fail at the "Provision" step with
#   "column ... cannot be cast automatically to type ...". scripts/db-migrate.sh
#   already carries the correct idempotent USING casts for known cases, but
#   that script only ever runs against the DEVELOPMENT database (via
#   scripts/post-merge.sh after a merge) — it never touches production.
#
# What this script does — and does NOT do:
#   This wrapper runs scripts/check-schema-drift.ts (SELECT-only queries
#   against information_schema.columns) against PRODUCTION so you can see,
#   BEFORE clicking Publish, whether production has the same text-vs-integer/
#   boolean drift dev once had. It is intentionally read-only.
#
#   It deliberately does NOT run scripts/db-migrate.sh (or any ALTER TABLE)
#   against production. Per this project's database-migration guardrails,
#   an agent/script must never execute DDL directly against production —
#   the only supported way to change the production schema is Replit's
#   Publish flow itself, or a human operator using Replit's own production
#   database console (Deployments pane), never a script checked into this
#   repo. If this script reports drift, apply the matching cast block from
#   scripts/db-migrate.sh to production manually via that console BEFORE
#   clicking Publish — see the "Before you Publish" checklist in replit.md.
#
# Usage:
#   PRODUCTION_DATABASE_URL="postgres://..." npm run db:check-drift:production
#
# Why a separate PRODUCTION_DATABASE_URL variable (not DATABASE_URL):
#   Requiring a distinctly-named variable makes it structurally impossible to
#   run this against production "by accident" just because DATABASE_URL
#   happens to be set in the shell — you must deliberately supply the
#   production connection string for this one invocation.
set -euo pipefail

: "${PRODUCTION_DATABASE_URL:?PRODUCTION_DATABASE_URL must be set to the production connection string (never reuse the dev DATABASE_URL here)}"

echo "=== check-schema-drift-production: read-only drift check against PRODUCTION ==="
echo "This does NOT modify production. It only reports drift; any fix must be"
echo "applied manually via Replit's production database console — see replit.md."
echo ""

# Scope the child process's env so check-schema-drift.ts (which reads
# DATABASE_URL / NEON_DATABASE_URL) targets production for this run only,
# without mutating the parent shell's environment.
DATABASE_URL="$PRODUCTION_DATABASE_URL" NEON_DATABASE_URL="" npx tsx scripts/check-schema-drift.ts
