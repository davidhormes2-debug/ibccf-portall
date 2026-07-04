-- Task #178 — Align cases.certificate_fee_status vocabulary with
-- cases.stamp_duty_status. The "user uploaded fee receipt, awaiting
-- admin review" state was previously stored as 'pending', while the
-- stamp-duty mirror column uses 'awaiting_admin_approval'. The write
-- path (POST /api/cases/:id/certificate/fee-payments) now stamps
-- 'awaiting_admin_approval'; this migration backfills any rows still
-- carrying the legacy 'pending' word so portal/admin readers see one
-- vocabulary everywhere.
UPDATE cases
SET certificate_fee_status = 'awaiting_admin_approval'
WHERE certificate_fee_status = 'pending';
