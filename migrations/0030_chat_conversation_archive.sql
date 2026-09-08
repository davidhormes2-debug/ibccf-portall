ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "chat_state" text NOT NULL DEFAULT 'inbox',
  ADD COLUMN IF NOT EXISTS "chat_pinned" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "chat_tags" text NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "chat_assigned_to" text,
  ADD COLUMN IF NOT EXISTS "chat_muted_until" timestamp,
  ADD COLUMN IF NOT EXISTS "chat_urgent_repeat" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "chat_last_activity_at" timestamp,
  ADD COLUMN IF NOT EXISTS "chat_archived_at" timestamp,
  ADD COLUMN IF NOT EXISTS "chat_archived_by" text;

CREATE INDEX IF NOT EXISTS "cases_chat_archived_at_idx"
  ON "cases" ("chat_archived_at");
CREATE INDEX IF NOT EXISTS "cases_chat_state_idx"
  ON "cases" ("chat_state");
CREATE INDEX IF NOT EXISTS "cases_chat_pinned_idx"
  ON "cases" ("chat_pinned");