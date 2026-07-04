#!/bin/bash
# scripts/db-migrate.sh
#
# Idempotent schema migration script.
#
# Run this BEFORE `npm run db:push` to fix any column-type drift that drizzle-kit
# cannot auto-cast.  Every statement uses IF NOT EXISTS / USING / conditional
# guards so it is safe to run multiple times.
#
# Why this exists:
#   drizzle-kit push cannot automatically cast text → integer when a column was
#   originally created as text and the schema later changed to integer.  Rather
#   than silently leaving the DB out of sync, this script applies those casts
#   explicitly with USING, then db:push handles any remaining structural diff.
#
# How to add a new migration:
#   Append a clearly-labelled block at the bottom.  Every block must be
#   idempotent (safe to run when already applied).
#
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"

echo "=== db-migrate: applying idempotent schema migrations ==="

# ---------------------------------------------------------------------------
# community_threads — fix text→integer type drift for view_count / reply_count
#
# These columns were originally created as text (matching an older schema) but
# the current shared/schema.ts defines them as integer.  drizzle-kit errors
# with "cannot be cast automatically to type integer".  We drop the text
# default, cast with USING, then restore the integer default.
# ---------------------------------------------------------------------------

echo "  [community_threads] casting view_count text→integer if needed..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'community_threads'
      AND column_name = 'view_count'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE community_threads ALTER COLUMN view_count DROP DEFAULT;
    ALTER TABLE community_threads
      ALTER COLUMN view_count TYPE integer USING view_count::integer;
    ALTER TABLE community_threads ALTER COLUMN view_count SET DEFAULT 0;
    RAISE NOTICE 'community_threads.view_count cast text→integer';
  ELSE
    RAISE NOTICE 'community_threads.view_count already integer — skipped';
  END IF;
END
$$;
SQL

echo "  [community_threads] casting reply_count text→integer if needed..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'community_threads'
      AND column_name = 'reply_count'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE community_threads ALTER COLUMN reply_count DROP DEFAULT;
    ALTER TABLE community_threads
      ALTER COLUMN reply_count TYPE integer USING reply_count::integer;
    ALTER TABLE community_threads ALTER COLUMN reply_count SET DEFAULT 0;
    RAISE NOTICE 'community_threads.reply_count cast text→integer';
  ELSE
    RAISE NOTICE 'community_threads.reply_count already integer — skipped';
  END IF;
END
$$;
SQL

# ---------------------------------------------------------------------------
# ADD COLUMN IF NOT EXISTS guards
#
# These ensure columns that were added to schema.ts but may not have been
# applied to the live DB (because db:push was broken) are always present.
# ---------------------------------------------------------------------------

echo "  [community_threads] ensuring is_flagged column exists..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "ALTER TABLE community_threads ADD COLUMN IF NOT EXISTS is_flagged boolean NOT NULL DEFAULT false;"

echo "  [community_threads] ensuring flag_reason column exists..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "ALTER TABLE community_threads ADD COLUMN IF NOT EXISTS flag_reason text;"

echo "  [community_posts] ensuring is_flagged column exists..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS is_flagged boolean NOT NULL DEFAULT false;"

echo "  [community_posts] ensuring flag_reason column exists..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS flag_reason text;"

echo "=== db-migrate: done ==="
