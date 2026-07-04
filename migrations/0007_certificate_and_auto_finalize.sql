-- Task #70 — NDA-triggered auto-finalization + Merge Phrase Certificate.

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS auto_finalized_at timestamp,
  ADD COLUMN IF NOT EXISTS auto_finalized_by text,
  ADD COLUMN IF NOT EXISTS certificate_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS certificate_fee_percent text,
  ADD COLUMN IF NOT EXISTS certificate_fee_status text DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS certificate_fee_approved_at timestamp,
  ADD COLUMN IF NOT EXISTS certificate_fee_approved_by text;

CREATE TABLE IF NOT EXISTS certificate_fee_payments (
  id serial PRIMARY KEY,
  case_id varchar NOT NULL REFERENCES cases(id),
  amount_usdt text NOT NULL,
  percent_used text NOT NULL,
  base_amount_used text NOT NULL,
  file_data text NOT NULL,
  file_name text,
  notes text,
  status text NOT NULL DEFAULT 'pending',
  admin_notes text,
  reviewed_at timestamp,
  reviewed_by text,
  uploaded_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS certificate_fee_payments_case_idx
  ON certificate_fee_payments(case_id);
