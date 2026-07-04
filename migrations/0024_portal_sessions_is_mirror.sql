-- Add is_mirror flag to portal_sessions.
-- Mirror (admin-impersonation) sessions are minted by createMirrorSession and
-- must be distinguishable from genuine user sessions server-side so that
-- requirePortalSessionOnly can reject them on consent-bearing routes (NDA
-- preview / sign) where only real user participation is acceptable.
--
-- Defaults to false — all existing rows are ordinary user sessions and remain
-- valid without any data change. The column is set to true at insert time by
-- createMirrorSession in server/services/session-store.ts.
ALTER TABLE portal_sessions
  ADD COLUMN IF NOT EXISTS is_mirror boolean NOT NULL DEFAULT false;
