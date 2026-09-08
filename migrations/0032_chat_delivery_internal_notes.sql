ALTER TABLE "chat_messages"
  ADD COLUMN IF NOT EXISTS "is_internal" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "delivered_at" timestamp,
  ADD COLUMN IF NOT EXISTS "read_at" timestamp;

CREATE INDEX IF NOT EXISTS "chat_messages_case_internal_idx"
  ON "chat_messages" ("case_id", "is_internal");