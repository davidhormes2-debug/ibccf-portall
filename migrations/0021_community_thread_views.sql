-- Task #489: Persist view-count deduplication in the database
-- Replaces the process-local Map in community.ts with a lightweight DB table.
-- One row per (thread_id, ip_hash, hour_bucket); unique index prevents doubles
-- across restarts and autoscale instances.  Old rows are pruned by the route.

CREATE TABLE IF NOT EXISTS "community_thread_views" (
  "id"          serial PRIMARY KEY,
  "thread_id"   integer NOT NULL REFERENCES "community_threads"("id") ON DELETE CASCADE,
  "ip_hash"     text    NOT NULL,
  "hour_bucket" text    NOT NULL,   -- YYYYMMDDHH in UTC, e.g. '2026052714'
  "created_at"  timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "community_thread_views_uniq"
  ON "community_thread_views" ("thread_id", "ip_hash", "hour_bucket");
