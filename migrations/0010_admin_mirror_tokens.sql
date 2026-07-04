-- Task #119 — Move admin "Open as User" mirror tokens out of process memory
-- so the mint and redeem requests can hit different app instances under
-- autoscale and still find the same single-use token.

CREATE TABLE IF NOT EXISTS "admin_mirror_tokens" (
  "token" text PRIMARY KEY,
  "case_id" varchar NOT NULL,
  "access_code" text NOT NULL,
  "issued_by" text NOT NULL,
  "reason" text NOT NULL,
  "issuer_ip" text,
  "issuer_user_agent" text,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "admin_mirror_tokens_expires_at_idx"
  ON "admin_mirror_tokens" ("expires_at");
