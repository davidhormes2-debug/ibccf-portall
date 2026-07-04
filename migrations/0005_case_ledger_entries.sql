-- Task #55 — Admin per-case ledger with optional user visibility.
-- Schema change pre-approved by the user as part of the task request.
--
-- 1. New column on `cases` so we can detect manual overrides of the
--    displayed balance. When admin auto-syncs via a ledger entry, BOTH
--    `user_balance` and `user_balance_last_synced_total` get the new
--    computed total. When admin edits `user_balance` directly through
--    the case editor, `user_balance` diverges — the ledger panel then
--    shows "Manual override active" and stops auto-syncing until the
--    admin clicks "Sync balance to ledger total".
ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "user_balance_last_synced_total" text;

-- 2. New per-case ledger table. Display-only — entries describe
--    accounting state; this platform does NOT route, hold, or relay
--    funds. `user_visible=true` exposes the (sanitised) row to the
--    portal Account History card.
CREATE TABLE IF NOT EXISTS "case_ledger_entries" (
  "id" serial PRIMARY KEY,
  "case_id" varchar NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "direction" text NOT NULL,
  "amount" text NOT NULL,
  "asset" text NOT NULL DEFAULT 'USDT',
  "category" text,
  "entry_date" timestamp NOT NULL DEFAULT now(),
  "user_visible" boolean NOT NULL DEFAULT false,
  "user_note" text,
  "admin_note" text,
  "created_by" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "case_ledger_entries_direction_check"
    CHECK ("direction" IN ('credit','debit'))
);

CREATE INDEX IF NOT EXISTS "case_ledger_entries_case_id_idx"
  ON "case_ledger_entries" ("case_id");
