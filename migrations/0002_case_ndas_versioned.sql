-- Allow multiple signed NDA rows per case so an admin override can
-- preserve the historical signed artifact while still letting the
-- user re-sign a fresh NDA. The "current" NDA is now the most recent
-- createdAt for the case, not the (formerly unique) row.
ALTER TABLE "case_ndas" DROP CONSTRAINT IF EXISTS "case_ndas_case_id_unique";
ALTER TABLE "case_ndas" DROP CONSTRAINT IF EXISTS "case_ndas_case_id_key";
CREATE INDEX IF NOT EXISTS "case_ndas_case_id_created_at_idx"
  ON "case_ndas" ("case_id", "created_at" DESC);
