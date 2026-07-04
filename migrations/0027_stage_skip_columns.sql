-- Stage-skip request workflow: non-sequential stage transition requests
-- submitted by agent/admin, reviewed and actioned by super_admin only.
ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "stage_skip_requested_by" text,
  ADD COLUMN IF NOT EXISTS "stage_skip_requested_at" timestamp,
  ADD COLUMN IF NOT EXISTS "stage_skip_target_stage" text,
  ADD COLUMN IF NOT EXISTS "stage_skip_reason" text,
  ADD COLUMN IF NOT EXISTS "stage_skip_status" text;
