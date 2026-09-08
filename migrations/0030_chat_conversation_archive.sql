ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "chat_archived_at" timestamp,
  ADD COLUMN IF NOT EXISTS "chat_archived_by" text;

CREATE INDEX IF NOT EXISTS "cases_chat_archived_at_idx"
  ON "cases" ("chat_archived_at");
