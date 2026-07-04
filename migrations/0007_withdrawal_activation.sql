-- Task #66: Final-stage Withdrawal Activation flow
-- Adds per-case activation fields + new withdrawal_security_tokens table.

ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "withdrawal_activation_min_usdt" text,
  ADD COLUMN IF NOT EXISTS "withdrawal_security_token_required" boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS "withdrawal_address_submitted" text,
  ADD COLUMN IF NOT EXISTS "withdrawal_details_asset" text,
  ADD COLUMN IF NOT EXISTS "withdrawal_details_network" text,
  ADD COLUMN IF NOT EXISTS "withdrawal_details_amount" text,
  ADD COLUMN IF NOT EXISTS "withdrawal_details_memo" text,
  ADD COLUMN IF NOT EXISTS "withdrawal_activation_status" text DEFAULT 'pending_address',
  ADD COLUMN IF NOT EXISTS "withdrawal_activation_receipt_id" integer,
  ADD COLUMN IF NOT EXISTS "withdrawal_activation_approved_at" timestamp,
  ADD COLUMN IF NOT EXISTS "withdrawal_activation_approved_by" text,
  ADD COLUMN IF NOT EXISTS "withdrawal_activation_rejected_at" timestamp,
  ADD COLUMN IF NOT EXISTS "withdrawal_activation_rejection_reason" text,
  ADD COLUMN IF NOT EXISTS "withdrawal_address_submitted_at" timestamp,
  ADD COLUMN IF NOT EXISTS "withdrawal_token_verified_at" timestamp;

CREATE TABLE IF NOT EXISTS "withdrawal_security_tokens" (
  "id" serial PRIMARY KEY,
  "case_id" varchar NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp,
  "attempts" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "withdrawal_security_tokens_case_id_idx"
  ON "withdrawal_security_tokens" ("case_id");
