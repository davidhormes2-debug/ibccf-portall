-- Enforce "at most one pending withdrawal request per case" at the DB level.
-- Prevents race-conditioned duplicate submissions that the application-level
-- read-then-insert check cannot catch under concurrent requests.
CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_requests_one_pending_per_case
  ON withdrawal_requests (case_id)
  WHERE status = 'pending';
