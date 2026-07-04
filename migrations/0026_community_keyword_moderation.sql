-- Migration: add keyword moderation columns to community tables
-- and create the community_keyword_blocklist table if not already present.

ALTER TABLE "community_posts"
  ADD COLUMN IF NOT EXISTS "is_flagged" boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "flag_reason" text;

ALTER TABLE "community_threads"
  ADD COLUMN IF NOT EXISTS "is_flagged" boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "flag_reason" text;

CREATE TABLE IF NOT EXISTS "community_keyword_blocklist" (
  "id" serial PRIMARY KEY NOT NULL,
  "pattern" text NOT NULL,
  "is_wildcard" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "created_by" text
);
