-- Session Refresh Deposit gate
-- Adds seven columns to `cases` and a new `session_refresh_receipts` table.

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS session_refresh_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS session_refresh_address  text,
  ADD COLUMN IF NOT EXISTS session_refresh_amount   text,
  ADD COLUMN IF NOT EXISTS session_refresh_asset    text,
  ADD COLUMN IF NOT EXISTS session_refresh_network  text,
  ADD COLUMN IF NOT EXISTS session_refresh_note     text,
  ADD COLUMN IF NOT EXISTS session_refresh_status   text;

CREATE TABLE IF NOT EXISTS session_refresh_receipts (
  id           serial      PRIMARY KEY,
  case_id      varchar     NOT NULL REFERENCES cases(id),
  tx_hash      text,
  receipt_data text        NOT NULL,
  file_name    text,
  admin_notes  text,
  reviewed_at  timestamp,
  reviewed_by  text,
  submitted_at timestamp   NOT NULL DEFAULT now()
);
