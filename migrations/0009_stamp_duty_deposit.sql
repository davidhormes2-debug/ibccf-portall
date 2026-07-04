-- Task #72 — Stamp Duty Deposit gate.
-- Adds per-case stamp duty toggle/amount/status columns and a
-- stamp_duty_receipts table mirroring the certificate_fee_payments
-- shape. The server-side gate in POST /api/cases/:id/nda/sign refuses
-- to seal the NDA until status='approved' (or stamp_duty_enabled=false).

ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "stamp_duty_enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "stamp_duty_amount_usdt" text,
  ADD COLUMN IF NOT EXISTS "stamp_duty_status" text NOT NULL DEFAULT 'awaiting_upload',
  ADD COLUMN IF NOT EXISTS "stamp_duty_approved_at" timestamp,
  ADD COLUMN IF NOT EXISTS "stamp_duty_approved_by" text,
  ADD COLUMN IF NOT EXISTS "stamp_duty_rejection_reason" text;

CREATE TABLE IF NOT EXISTS "stamp_duty_receipts" (
  "id" serial PRIMARY KEY,
  "case_id" varchar NOT NULL REFERENCES "cases"("id"),
  "amount_usdt" text NOT NULL,
  "file_data" text NOT NULL,
  "file_name" text,
  "notes" text,
  "status" text NOT NULL DEFAULT 'pending',
  "admin_notes" text,
  "reviewed_at" timestamp,
  "reviewed_by" text,
  "uploaded_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "stamp_duty_receipts_case_id_idx"
  ON "stamp_duty_receipts" ("case_id");
