CREATE TABLE IF NOT EXISTS "chat_attachments" (
  "id" serial PRIMARY KEY,
  "message_id" integer NOT NULL REFERENCES "chat_messages"("id") ON DELETE CASCADE,
  "case_id" varchar NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "file_data" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "chat_attachments_message_id_idx"
  ON "chat_attachments" ("message_id");
CREATE INDEX IF NOT EXISTS "chat_attachments_case_id_idx"
  ON "chat_attachments" ("case_id");
