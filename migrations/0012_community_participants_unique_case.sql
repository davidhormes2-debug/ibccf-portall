-- Enforce "at most one community participant row per case" at the DB level.
-- The application-level read-then-insert pattern in
-- getOrCreateParticipantForSession (server/routes/community.ts) cannot prevent
-- two app instances from racing to insert duplicate participant rows for the
-- same case on the user's first community request. A unique index makes the
-- race deterministic and lets us upsert via ON CONFLICT (case_id) DO NOTHING.
--
-- Notes:
--   * The index is NOT partial. case_id is nullable, but Postgres' default
--     NULLS DISTINCT semantics already permit multiple NULL rows under a
--     plain unique index. Keeping it non-partial means
--     `ON CONFLICT (case_id)` can use it as an arbiter without also having
--     to specify a matching WHERE predicate.
--   * Before creating the index we dedupe any historical duplicates that may
--     have been written before the constraint existed. For each case_id we
--     keep the oldest (lowest id) participant, re-point any community_reactions
--     pointing at a soon-to-be-deleted duplicate, and then drop the dupes.

WITH ranked AS (
  SELECT id,
         case_id,
         MIN(id) OVER (PARTITION BY case_id) AS keeper_id
  FROM community_participants
  WHERE case_id IS NOT NULL
)
UPDATE community_reactions cr
SET participant_id = r.keeper_id
FROM ranked r
WHERE cr.participant_id = r.id
  AND r.id <> r.keeper_id;

DELETE FROM community_participants p
USING (
  SELECT id,
         MIN(id) OVER (PARTITION BY case_id) AS keeper_id
  FROM community_participants
  WHERE case_id IS NOT NULL
) r
WHERE p.id = r.id
  AND p.id <> r.keeper_id;

CREATE UNIQUE INDEX IF NOT EXISTS community_participants_unique_case_id
  ON community_participants (case_id);
