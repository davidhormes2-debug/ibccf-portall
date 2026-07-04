-- Task #95 — Retire the legacy english_only_signing compatibility layer.
--
-- Task #88 replaced the boolean english_only_signing app_setting with a JSON
-- array nda_signing_locales. The runtime previously fell back to reading the
-- legacy row on each cache miss so existing deployments kept their behaviour
-- without an explicit admin save. This migration writes the new row exactly
-- once so the legacy read path can be deleted: if nda_signing_locales is
-- already populated we leave it alone, otherwise we translate the legacy
-- boolean (true → ["en"], false → all six supported locales) or fall back to
-- the compile-time default of ["en"] when neither row exists.

INSERT INTO app_settings (key, value, updated_by, updated_at)
SELECT
  'nda_signing_locales',
  CASE
    WHEN lower(coalesce(legacy.value, '')) IN ('true', '1', 'yes', 'on')
      THEN '["en"]'
    WHEN lower(coalesce(legacy.value, '')) IN ('false', '0', 'no', 'off')
      THEN '["en","es","fr","de","pt","zh"]'
    ELSE '["en"]'
  END,
  coalesce(legacy.updated_by, 'system-migration-0008'),
  now()
FROM (SELECT 1) AS _
LEFT JOIN app_settings legacy ON legacy.key = 'english_only_signing'
WHERE NOT EXISTS (
  SELECT 1 FROM app_settings WHERE key = 'nda_signing_locales'
);
