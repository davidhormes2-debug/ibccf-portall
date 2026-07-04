-- Add last_activity_at to portal_sessions.
-- Task: admins need to see when a user's active session was last used, not
-- just that a session currently exists. Bumped on every successful
-- validateSession() call (server/services/session-store.ts) via
-- storage.updatePortalSessionActivity(token), independent of createdAt /
-- expiresAt.
--
-- Defaults to now() so existing rows get a sane initial value (roughly "as
-- of this migration") rather than a NULL that would break the NOT NULL
-- constraint or the ORDER BY last_activity_at DESC in
-- getActivePortalSessionByCaseId. The next request on each session will
-- refresh it to the true last-used time.
ALTER TABLE portal_sessions
  ADD COLUMN IF NOT EXISTS last_activity_at timestamp NOT NULL DEFAULT now();
