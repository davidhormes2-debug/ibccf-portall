-- Task #158 — Add a structured `metadata` jsonb column to audit_logs so
-- email_<tag> rows can carry a stable foreign key to the source record
-- (declaration submission id, admin message id, document request id,
-- deposit receipt id, letter reissue id, ...). The retry handler in
-- POST /api/cases/:id/email-audit-logs/:auditId/retry uses this to
-- re-send the *exact* original content instead of the latest matching
-- row on the case.

ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "metadata" jsonb;
