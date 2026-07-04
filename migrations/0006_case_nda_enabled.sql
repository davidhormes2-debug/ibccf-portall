-- Per-case NDA toggle. Defaults to TRUE so every existing case keeps
-- its current behaviour (NDA required at stage 14). When the admin
-- flips it OFF, the portal hides the typed-signature flow and the
-- POST /api/cases/:id/nda/sign endpoint rejects new submissions.
-- See `cases.nda_enabled` comment in shared/schema.ts for rationale.
ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "nda_enabled" boolean DEFAULT true;
