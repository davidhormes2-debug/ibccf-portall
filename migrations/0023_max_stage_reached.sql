-- Task #1035: Add max_stage_reached to cases table.
-- Tracks the highest withdrawal stage this case has ever reached so the
-- portal can preserve access to nav items and deliverables even after an
-- admin rolls the live withdrawal_stage back.
--
-- Nullable integer — NULL means the high-water mark has never been
-- explicitly set; the portal and server treat NULL as the current
-- withdrawal_stage value, never as zero. The column is only set forward,
-- never decremented.
--
-- Backfill: seed every existing row with the current numeric value of
-- withdrawal_stage (or NULL when withdrawal_stage is NULL / non-numeric)
-- so existing cases start with correct high-water marks on deploy.
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS max_stage_reached INTEGER;

UPDATE cases
SET max_stage_reached = withdrawal_stage::integer
WHERE withdrawal_stage IS NOT NULL
  AND withdrawal_stage ~ '^[0-9]+$'
  AND max_stage_reached IS NULL;
