-- Fix community_threads.view_count and reply_count column types
-- Both columns were created as text with '0'::text defaults but the schema
-- defines them as integer. drizzle-kit cannot emit the required USING cast
-- automatically, so this migration applies it explicitly.
--
-- Steps: drop default → alter type with USING cast → restore integer default.
-- Already applied to the dev database on 2026-07-02; included here so the fix
-- is auditable and replayable in any fresh environment.

ALTER TABLE community_threads ALTER COLUMN view_count DROP DEFAULT;
ALTER TABLE community_threads ALTER COLUMN view_count TYPE integer USING view_count::integer;
ALTER TABLE community_threads ALTER COLUMN view_count SET DEFAULT 0;

ALTER TABLE community_threads ALTER COLUMN reply_count DROP DEFAULT;
ALTER TABLE community_threads ALTER COLUMN reply_count TYPE integer USING reply_count::integer;
ALTER TABLE community_threads ALTER COLUMN reply_count SET DEFAULT 0;
