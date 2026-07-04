-- Task #163 — Unified receipt uploads + admin mirror
--
-- Add `category` column to deposit_receipts so the unified portal uploader
-- (Activation / Reissue / Other) can record what kind of payment each
-- receipt represents. App-layer enum, no DB CHECK — keeps the column
-- forward-compatible if we add categories later.
--
-- Backfill: rows linked to a letterReissues round are 'reissue'; every
-- other historical row is the legacy 1,500 USDT activation deposit.
ALTER TABLE deposit_receipts
  ADD COLUMN IF NOT EXISTS category text;

UPDATE deposit_receipts
  SET category = CASE
    WHEN reissue_id IS NOT NULL THEN 'reissue'
    ELSE 'activation'
  END
WHERE category IS NULL;
