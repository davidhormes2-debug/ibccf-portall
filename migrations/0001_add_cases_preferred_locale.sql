-- Add cases.preferred_locale so admin-triggered emails can render in the
-- recipient's language. Nullable; the portal back-fills it on sign-in and
-- on every locale switch. Mirrors the column added to shared/schema.ts.
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "preferred_locale" text;
