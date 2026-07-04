-- Task #126 — cascade community participant rows when their case is deleted
-- (or pruned by the scheduled cleanup), and cascade reactions / earned
-- badges off the participant row in turn. Before this migration, deleting
-- a case left orphan handles in community_participants and any reactions
-- the user had authored would block the delete with an FK violation
-- because the participant row could never go away cleanly.
--
-- The constraint names below are the drizzle-kit defaults; older databases
-- created via `db:push` may have used the pg-default name (<table>_<col>_fkey)
-- instead, so we DROP IF EXISTS both variants before re-adding with the
-- desired ON DELETE CASCADE.

ALTER TABLE "community_participants"
  DROP CONSTRAINT IF EXISTS "community_participants_case_id_cases_id_fk";
ALTER TABLE "community_participants"
  DROP CONSTRAINT IF EXISTS "community_participants_case_id_fkey";
ALTER TABLE "community_participants"
  ADD CONSTRAINT "community_participants_case_id_cases_id_fk"
  FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE;

ALTER TABLE "community_reactions"
  DROP CONSTRAINT IF EXISTS "community_reactions_participant_id_community_participants_id_fk";
ALTER TABLE "community_reactions"
  DROP CONSTRAINT IF EXISTS "community_reactions_participant_id_fkey";
ALTER TABLE "community_reactions"
  ADD CONSTRAINT "community_reactions_participant_id_community_participants_id_fk"
  FOREIGN KEY ("participant_id") REFERENCES "community_participants"("id") ON DELETE CASCADE;

ALTER TABLE "earned_badges"
  DROP CONSTRAINT IF EXISTS "earned_badges_participant_id_community_participants_id_fk";
ALTER TABLE "earned_badges"
  DROP CONSTRAINT IF EXISTS "earned_badges_participant_id_fkey";
ALTER TABLE "earned_badges"
  ADD CONSTRAINT "earned_badges_participant_id_community_participants_id_fk"
  FOREIGN KEY ("participant_id") REFERENCES "community_participants"("id") ON DELETE CASCADE;
