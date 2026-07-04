-- Task #171 — The 0016 backfill (Task #159) stamped legacy
-- `email_<tag>_failed` audit rows that matched more than one source
-- record as `{ ambiguous: true, reason: 'multiple_source_records' }`
-- but didn't capture *which* candidate ids were in the running. The
-- dashboard now surfaces the candidate list in a "Details" popover so
-- admins can click through to the correct source row and re-run the
-- action there. This migration extends rows that were already stamped
-- under the old (no-candidateIds) shape to add the missing field.
--
-- Idempotent: only touches ambiguous-by-multiple rows that are missing
-- `candidateIds`. Single-match and no-source-record rows are untouched.
-- Fresh runs of 0016 already include `candidateIds` directly.

BEGIN;

-- 1. email_declaration-rejected_failed  →  declaration_submissions(status='rejected')
UPDATE audit_logs a
   SET metadata = a.metadata || jsonb_build_object(
         'candidateIds',
         coalesce(
           (SELECT jsonb_agg(s.id ORDER BY s.id)
              FROM declaration_submissions s
             WHERE s.case_id = a.target_id AND s.status = 'rejected'),
           '[]'::jsonb
         )
       )
 WHERE a.action = 'email_declaration-rejected_failed'
   AND a.target_type = 'case'
   AND a.metadata ? 'ambiguous'
   AND a.metadata->>'reason' = 'multiple_source_records'
   AND NOT (a.metadata ? 'candidateIds');

-- 2. email_compliance-message_failed  →  admin_messages
UPDATE audit_logs a
   SET metadata = a.metadata || jsonb_build_object(
         'candidateIds',
         coalesce(
           (SELECT jsonb_agg(m.id ORDER BY m.id)
              FROM admin_messages m
             WHERE m.case_id = a.target_id),
           '[]'::jsonb
         )
       )
 WHERE a.action = 'email_compliance-message_failed'
   AND a.target_type = 'case'
   AND a.metadata ? 'ambiguous'
   AND a.metadata->>'reason' = 'multiple_source_records'
   AND NOT (a.metadata ? 'candidateIds');

-- 3. email_document-requested_failed  →  document_requests (any status)
UPDATE audit_logs a
   SET metadata = a.metadata || jsonb_build_object(
         'candidateIds',
         coalesce(
           (SELECT jsonb_agg(r.id ORDER BY r.id)
              FROM document_requests r
             WHERE r.case_id = a.target_id),
           '[]'::jsonb
         )
       )
 WHERE a.action = 'email_document-requested_failed'
   AND a.target_type = 'case'
   AND a.metadata ? 'ambiguous'
   AND a.metadata->>'reason' = 'multiple_source_records'
   AND NOT (a.metadata ? 'candidateIds');

-- 4. email_document-approved_failed  →  document_requests(status='approved')
UPDATE audit_logs a
   SET metadata = a.metadata || jsonb_build_object(
         'candidateIds',
         coalesce(
           (SELECT jsonb_agg(r.id ORDER BY r.id)
              FROM document_requests r
             WHERE r.case_id = a.target_id AND r.status = 'approved'),
           '[]'::jsonb
         )
       )
 WHERE a.action = 'email_document-approved_failed'
   AND a.target_type = 'case'
   AND a.metadata ? 'ambiguous'
   AND a.metadata->>'reason' = 'multiple_source_records'
   AND NOT (a.metadata ? 'candidateIds');

-- 5. email_document-rejected_failed  →  document_requests(status='rejected')
UPDATE audit_logs a
   SET metadata = a.metadata || jsonb_build_object(
         'candidateIds',
         coalesce(
           (SELECT jsonb_agg(r.id ORDER BY r.id)
              FROM document_requests r
             WHERE r.case_id = a.target_id AND r.status = 'rejected'),
           '[]'::jsonb
         )
       )
 WHERE a.action = 'email_document-rejected_failed'
   AND a.target_type = 'case'
   AND a.metadata ? 'ambiguous'
   AND a.metadata->>'reason' = 'multiple_source_records'
   AND NOT (a.metadata ? 'candidateIds');

-- 6. email_reissue-receipt-approved_failed
--    →  deposit_receipts(reissue_id NOT NULL, status='approved')
UPDATE audit_logs a
   SET metadata = a.metadata || jsonb_build_object(
         'candidateIds',
         coalesce(
           (SELECT jsonb_agg(d.id ORDER BY d.id)
              FROM deposit_receipts d
             WHERE d.case_id = a.target_id
               AND d.reissue_id IS NOT NULL
               AND d.status = 'approved'),
           '[]'::jsonb
         )
       )
 WHERE a.action = 'email_reissue-receipt-approved_failed'
   AND a.target_type = 'case'
   AND a.metadata ? 'ambiguous'
   AND a.metadata->>'reason' = 'multiple_source_records'
   AND NOT (a.metadata ? 'candidateIds');

-- 7. email_reissue-receipt-rejected_failed
--    →  deposit_receipts(reissue_id NOT NULL, status='rejected')
UPDATE audit_logs a
   SET metadata = a.metadata || jsonb_build_object(
         'candidateIds',
         coalesce(
           (SELECT jsonb_agg(d.id ORDER BY d.id)
              FROM deposit_receipts d
             WHERE d.case_id = a.target_id
               AND d.reissue_id IS NOT NULL
               AND d.status = 'rejected'),
           '[]'::jsonb
         )
       )
 WHERE a.action = 'email_reissue-receipt-rejected_failed'
   AND a.target_type = 'case'
   AND a.metadata ? 'ambiguous'
   AND a.metadata->>'reason' = 'multiple_source_records'
   AND NOT (a.metadata ? 'candidateIds');

COMMIT;
