-- Admin-controlled "Withdrawal Window" toggle on cases. When true, the
-- portal surfaces a "Request Withdrawal" CTA that opens the four-section
-- WithdrawalRequestDialog. Default false so existing cases keep the CTA
-- hidden until an admin explicitly opens the window.
ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "withdrawal_window_enabled" boolean DEFAULT false;

-- One row per user-submitted withdrawal request. Admin reviews from the
-- case detail dialog. The platform is display-only: approving a row here
-- NEVER routes, holds, or relays funds.
CREATE TABLE IF NOT EXISTS "withdrawal_requests" (
  "id" serial PRIMARY KEY,
  "case_id" varchar NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'pending',
  "amount" text NOT NULL,
  "asset" text NOT NULL,
  "network" text NOT NULL,
  "withdrawal_type" text NOT NULL DEFAULT 'full',
  "requested_wallet_address" text NOT NULL,
  "requested_wallet_asset" text,
  "requested_wallet_network" text,
  "preferred_payout_date" timestamp,
  "confirmation_channel" text NOT NULL DEFAULT 'email',
  "two_factor_provided_at" timestamp,
  "terms_accepted_at" timestamp NOT NULL DEFAULT now(),
  "user_note" text,
  "req_ip" text,
  "req_user_agent" text,
  "reviewed_at" timestamp,
  "reviewed_by" text,
  "admin_note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "withdrawal_requests_status_check"
    CHECK ("status" IN ('pending','approved','rejected','cancelled')),
  CONSTRAINT "withdrawal_requests_type_check"
    CHECK ("withdrawal_type" IN ('full','partial')),
  CONSTRAINT "withdrawal_requests_channel_check"
    CHECK ("confirmation_channel" IN ('email','sms','both'))
);

CREATE INDEX IF NOT EXISTS "withdrawal_requests_case_id_idx"
  ON "withdrawal_requests" ("case_id");
CREATE INDEX IF NOT EXISTS "withdrawal_requests_status_idx"
  ON "withdrawal_requests" ("status");
