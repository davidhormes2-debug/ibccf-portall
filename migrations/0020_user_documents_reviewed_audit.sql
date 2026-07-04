ALTER TABLE user_documents
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp,
  ADD COLUMN IF NOT EXISTS reviewed_by text;
