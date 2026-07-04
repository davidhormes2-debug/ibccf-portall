-- Task #159 — Backfill metadata on legacy `email_<tag>_failed` audit rows
-- so the per-row retry handler (added in Task #158) can map them back to
-- their source record. Failures recorded before Task #158 have no
-- metadata; the retry handler then falls back to "latest matching row on
-- the case" — exactly the bug Task #158 fixed for new sends. This
-- one-shot backfill stamps the unambiguous 1:1 mappings and explicitly
-- marks everything else `{ "ambiguous": true }` so the admin dashboard
-- suppresses Retry on rows we can't safely replay.
--
-- Match rule (per the task): for each retryable tag, count source
-- records on the same case that match the tag's natural filter. If
-- exactly one matches → stamp the FK (and any snapshot fields the live
-- writers in Task #158 now persist). Otherwise → write
-- `{ "ambiguous": true, "reason": ..., "backfilled": true }` so the
-- retry handler refuses and the dashboard hides the button with a
-- tooltip.
--
-- Task #171 — when the reason is `multiple_source_records`, also
-- capture the list of candidate source-record ids in `candidateIds` so
-- the dashboard can surface them in a "Details" popover and let the
-- admin click through to the correct row to re-run the action there.
-- (`no_source_record` deliberately omits the field — there are no
-- candidates to list.)
--
-- Only the seven retryable tags whose live retry handler *uses*
-- metadata for disambiguation are touched. The other retryable tags
-- (letter-ready, letter-reissued, payout-wallet-*, declaration-assigned,
-- declaration-approved, submission-received, account_reactivation) read
-- from current case state and don't need a stable foreign key, so they
-- are already safe to retry without metadata and are skipped here.
--
-- Idempotent: only rows with `metadata IS NULL` are touched, so rerunning
-- the migration is a no-op against rows already stamped (whether by the
-- Task #158 live writers or by an earlier run of this script).

BEGIN;

-- 1. email_declaration-rejected_failed  →  declaration_submissions(status='rejected')
WITH candidates AS (
  SELECT id AS audit_id, target_id AS case_id
    FROM audit_logs
   WHERE action = 'email_declaration-rejected_failed'
     AND target_type = 'case'
     AND metadata IS NULL
), counts AS (
  SELECT c.audit_id,
         c.case_id,
         (SELECT count(*)::int FROM declaration_submissions s
            WHERE s.case_id = c.case_id AND s.status = 'rejected') AS n,
         (SELECT s.id FROM declaration_submissions s
            WHERE s.case_id = c.case_id AND s.status = 'rejected'
            ORDER BY s.id LIMIT 1) AS sole_id,
         (SELECT s.reviewer_notes FROM declaration_submissions s
            WHERE s.case_id = c.case_id AND s.status = 'rejected'
            ORDER BY s.id LIMIT 1) AS sole_notes,
         (SELECT coalesce(jsonb_agg(s.id ORDER BY s.id), '[]'::jsonb)
            FROM declaration_submissions s
            WHERE s.case_id = c.case_id AND s.status = 'rejected') AS cand_ids
    FROM candidates c
)
UPDATE audit_logs a
   SET metadata = CASE
         WHEN k.n = 1 THEN jsonb_build_object(
           'declarationSubmissionId', k.sole_id,
           'reviewerNotes', k.sole_notes,
           'backfilled', true
         )
         WHEN k.n = 0 THEN jsonb_build_object(
           'ambiguous', true,
           'reason', 'no_source_record',
           'backfilled', true
         )
         ELSE jsonb_build_object(
           'ambiguous', true,
           'reason', 'multiple_source_records',
           'candidateIds', k.cand_ids,
           'backfilled', true
         )
       END
  FROM counts k
 WHERE a.id = k.audit_id;

-- 2. email_compliance-message_failed  →  admin_messages
WITH candidates AS (
  SELECT id AS audit_id, target_id AS case_id
    FROM audit_logs
   WHERE action = 'email_compliance-message_failed'
     AND target_type = 'case'
     AND metadata IS NULL
), counts AS (
  SELECT c.audit_id,
         c.case_id,
         (SELECT count(*)::int FROM admin_messages m WHERE m.case_id = c.case_id) AS n,
         (SELECT m.id FROM admin_messages m WHERE m.case_id = c.case_id
            ORDER BY m.id LIMIT 1) AS sole_id,
         (SELECT coalesce(jsonb_agg(m.id ORDER BY m.id), '[]'::jsonb)
            FROM admin_messages m WHERE m.case_id = c.case_id) AS cand_ids
    FROM candidates c
)
UPDATE audit_logs a
   SET metadata = CASE
         WHEN k.n = 1 THEN jsonb_build_object(
           'adminMessageId', k.sole_id,
           'backfilled', true
         )
         WHEN k.n = 0 THEN jsonb_build_object(
           'ambiguous', true,
           'reason', 'no_source_record',
           'backfilled', true
         )
         ELSE jsonb_build_object(
           'ambiguous', true,
           'reason', 'multiple_source_records',
           'candidateIds', k.cand_ids,
           'backfilled', true
         )
       END
  FROM counts k
 WHERE a.id = k.audit_id;

-- 3. email_document-requested_failed  →  document_requests
-- Note: the live writer also emits this tag for the KYC ID bundle (4
-- requests in one email). The bundle case is inherently ambiguous from
-- history alone, so a case with 4+ requests created together will fall
-- into the "multiple_source_records" branch — correct: we can't tell
-- whether this audit row was the bundle email or a single-doc request.
WITH candidates AS (
  SELECT id AS audit_id, target_id AS case_id
    FROM audit_logs
   WHERE action = 'email_document-requested_failed'
     AND target_type = 'case'
     AND metadata IS NULL
), counts AS (
  SELECT c.audit_id,
         c.case_id,
         (SELECT count(*)::int FROM document_requests r WHERE r.case_id = c.case_id) AS n,
         (SELECT r.id FROM document_requests r WHERE r.case_id = c.case_id
            ORDER BY r.id LIMIT 1) AS sole_id,
         (SELECT coalesce(jsonb_agg(r.id ORDER BY r.id), '[]'::jsonb)
            FROM document_requests r WHERE r.case_id = c.case_id) AS cand_ids
    FROM candidates c
)
UPDATE audit_logs a
   SET metadata = CASE
         WHEN k.n = 1 THEN jsonb_build_object(
           'documentRequestId', k.sole_id,
           'backfilled', true
         )
         WHEN k.n = 0 THEN jsonb_build_object(
           'ambiguous', true,
           'reason', 'no_source_record',
           'backfilled', true
         )
         ELSE jsonb_build_object(
           'ambiguous', true,
           'reason', 'multiple_source_records',
           'candidateIds', k.cand_ids,
           'backfilled', true
         )
       END
  FROM counts k
 WHERE a.id = k.audit_id;

-- 4. email_document-approved_failed  →  document_requests(status='approved')
WITH candidates AS (
  SELECT id AS audit_id, target_id AS case_id
    FROM audit_logs
   WHERE action = 'email_document-approved_failed'
     AND target_type = 'case'
     AND metadata IS NULL
), counts AS (
  SELECT c.audit_id,
         c.case_id,
         (SELECT count(*)::int FROM document_requests r
            WHERE r.case_id = c.case_id AND r.status = 'approved') AS n,
         (SELECT r.id FROM document_requests r
            WHERE r.case_id = c.case_id AND r.status = 'approved'
            ORDER BY r.id LIMIT 1) AS sole_id,
         (SELECT r.admin_notes FROM document_requests r
            WHERE r.case_id = c.case_id AND r.status = 'approved'
            ORDER BY r.id LIMIT 1) AS sole_notes,
         (SELECT coalesce(jsonb_agg(r.id ORDER BY r.id), '[]'::jsonb)
            FROM document_requests r
            WHERE r.case_id = c.case_id AND r.status = 'approved') AS cand_ids
    FROM candidates c
)
UPDATE audit_logs a
   SET metadata = CASE
         WHEN k.n = 1 THEN jsonb_build_object(
           'documentRequestId', k.sole_id,
           'decision', 'approved',
           'notes', k.sole_notes,
           'backfilled', true
         )
         WHEN k.n = 0 THEN jsonb_build_object(
           'ambiguous', true,
           'reason', 'no_source_record',
           'backfilled', true
         )
         ELSE jsonb_build_object(
           'ambiguous', true,
           'reason', 'multiple_source_records',
           'candidateIds', k.cand_ids,
           'backfilled', true
         )
       END
  FROM counts k
 WHERE a.id = k.audit_id;

-- 5. email_document-rejected_failed  →  document_requests(status='rejected')
WITH candidates AS (
  SELECT id AS audit_id, target_id AS case_id
    FROM audit_logs
   WHERE action = 'email_document-rejected_failed'
     AND target_type = 'case'
     AND metadata IS NULL
), counts AS (
  SELECT c.audit_id,
         c.case_id,
         (SELECT count(*)::int FROM document_requests r
            WHERE r.case_id = c.case_id AND r.status = 'rejected') AS n,
         (SELECT r.id FROM document_requests r
            WHERE r.case_id = c.case_id AND r.status = 'rejected'
            ORDER BY r.id LIMIT 1) AS sole_id,
         (SELECT r.admin_notes FROM document_requests r
            WHERE r.case_id = c.case_id AND r.status = 'rejected'
            ORDER BY r.id LIMIT 1) AS sole_notes,
         (SELECT coalesce(jsonb_agg(r.id ORDER BY r.id), '[]'::jsonb)
            FROM document_requests r
            WHERE r.case_id = c.case_id AND r.status = 'rejected') AS cand_ids
    FROM candidates c
)
UPDATE audit_logs a
   SET metadata = CASE
         WHEN k.n = 1 THEN jsonb_build_object(
           'documentRequestId', k.sole_id,
           'decision', 'rejected',
           'notes', k.sole_notes,
           'backfilled', true
         )
         WHEN k.n = 0 THEN jsonb_build_object(
           'ambiguous', true,
           'reason', 'no_source_record',
           'backfilled', true
         )
         ELSE jsonb_build_object(
           'ambiguous', true,
           'reason', 'multiple_source_records',
           'candidateIds', k.cand_ids,
           'backfilled', true
         )
       END
  FROM counts k
 WHERE a.id = k.audit_id;

-- 6. email_reissue-receipt-approved_failed
--    →  deposit_receipts(reissue_id NOT NULL, status='approved')
WITH candidates AS (
  SELECT id AS audit_id, target_id AS case_id
    FROM audit_logs
   WHERE action = 'email_reissue-receipt-approved_failed'
     AND target_type = 'case'
     AND metadata IS NULL
), counts AS (
  SELECT c.audit_id,
         c.case_id,
         (SELECT count(*)::int FROM deposit_receipts d
            WHERE d.case_id = c.case_id
              AND d.reissue_id IS NOT NULL
              AND d.status = 'approved') AS n,
         (SELECT d.id FROM deposit_receipts d
            WHERE d.case_id = c.case_id
              AND d.reissue_id IS NOT NULL
              AND d.status = 'approved'
            ORDER BY d.id LIMIT 1) AS sole_receipt,
         (SELECT d.reissue_id FROM deposit_receipts d
            WHERE d.case_id = c.case_id
              AND d.reissue_id IS NOT NULL
              AND d.status = 'approved'
            ORDER BY d.id LIMIT 1) AS sole_round,
         (SELECT coalesce(jsonb_agg(d.id ORDER BY d.id), '[]'::jsonb)
            FROM deposit_receipts d
            WHERE d.case_id = c.case_id
              AND d.reissue_id IS NOT NULL
              AND d.status = 'approved') AS cand_ids
    FROM candidates c
)
UPDATE audit_logs a
   SET metadata = CASE
         WHEN k.n = 1 THEN jsonb_build_object(
           'depositReceiptId', k.sole_receipt,
           'letterReissueId', k.sole_round,
           'backfilled', true
         )
         WHEN k.n = 0 THEN jsonb_build_object(
           'ambiguous', true,
           'reason', 'no_source_record',
           'backfilled', true
         )
         ELSE jsonb_build_object(
           'ambiguous', true,
           'reason', 'multiple_source_records',
           'candidateIds', k.cand_ids,
           'backfilled', true
         )
       END
  FROM counts k
 WHERE a.id = k.audit_id;

-- 7. email_reissue-receipt-rejected_failed
--    →  deposit_receipts(reissue_id NOT NULL, status='rejected')
WITH candidates AS (
  SELECT id AS audit_id, target_id AS case_id
    FROM audit_logs
   WHERE action = 'email_reissue-receipt-rejected_failed'
     AND target_type = 'case'
     AND metadata IS NULL
), counts AS (
  SELECT c.audit_id,
         c.case_id,
         (SELECT count(*)::int FROM deposit_receipts d
            WHERE d.case_id = c.case_id
              AND d.reissue_id IS NOT NULL
              AND d.status = 'rejected') AS n,
         (SELECT d.id FROM deposit_receipts d
            WHERE d.case_id = c.case_id
              AND d.reissue_id IS NOT NULL
              AND d.status = 'rejected'
            ORDER BY d.id LIMIT 1) AS sole_receipt,
         (SELECT d.reissue_id FROM deposit_receipts d
            WHERE d.case_id = c.case_id
              AND d.reissue_id IS NOT NULL
              AND d.status = 'rejected'
            ORDER BY d.id LIMIT 1) AS sole_round,
         (SELECT d.admin_notes FROM deposit_receipts d
            WHERE d.case_id = c.case_id
              AND d.reissue_id IS NOT NULL
              AND d.status = 'rejected'
            ORDER BY d.id LIMIT 1) AS sole_notes,
         (SELECT coalesce(jsonb_agg(d.id ORDER BY d.id), '[]'::jsonb)
            FROM deposit_receipts d
            WHERE d.case_id = c.case_id
              AND d.reissue_id IS NOT NULL
              AND d.status = 'rejected') AS cand_ids
    FROM candidates c
)
UPDATE audit_logs a
   SET metadata = CASE
         WHEN k.n = 1 THEN jsonb_build_object(
           'depositReceiptId', k.sole_receipt,
           'letterReissueId', k.sole_round,
           'notes', k.sole_notes,
           'backfilled', true
         )
         WHEN k.n = 0 THEN jsonb_build_object(
           'ambiguous', true,
           'reason', 'no_source_record',
           'backfilled', true
         )
         ELSE jsonb_build_object(
           'ambiguous', true,
           'reason', 'multiple_source_records',
           'candidateIds', k.cand_ids,
           'backfilled', true
         )
       END
  FROM counts k
 WHERE a.id = k.audit_id;

COMMIT;
