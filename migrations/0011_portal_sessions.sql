-- Task #123 — Move portal session tokens out of process memory so they
-- survive restarts and behave consistently across autoscale instances.
-- Previously the tokens lived in a per-process Map: a portal user signed
-- in on instance A would get a 401 if their next request was served by
-- instance B, and admin "Force logout" only dropped sessions from the
-- instance that processed the click.

CREATE TABLE IF NOT EXISTS "portal_sessions" (
  "token" text PRIMARY KEY,
  "case_id" varchar NOT NULL,
  "access_code" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS "portal_sessions_case_id_idx"
  ON "portal_sessions" ("case_id");

CREATE INDEX IF NOT EXISTS "portal_sessions_expires_at_idx"
  ON "portal_sessions" ("expires_at");
