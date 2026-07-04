-- Task #938: Add preferred_deposit_asset and preferred_deposit_network to cases table.
-- These are user-declared preferred settlement coin and network, persisted per case
-- and set from the portal Withdrawal view coin/currency selector. Admins can also
-- override from the case edit dialog. Default 'USDT'/'TRC20' matches the app-wide
-- fallback so existing rows are indistinguishable from newly-set rows.
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS preferred_deposit_asset TEXT DEFAULT 'USDT',
  ADD COLUMN IF NOT EXISTS preferred_deposit_network TEXT DEFAULT 'TRC20';
