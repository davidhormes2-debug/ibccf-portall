-- Portal closure warning columns (admin-triggered timed overlay + auto-logout).
-- portalWarningAt: timestamp when the warning was sent (used to compute expiry client-side).
-- portalWarningMinutes: duration in minutes; expiry = portalWarningAt + portalWarningMinutes * 60 s.
-- portalWarningMessage: optional admin message shown inside the overlay.
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS portal_warning_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS portal_warning_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS portal_warning_message TEXT;
