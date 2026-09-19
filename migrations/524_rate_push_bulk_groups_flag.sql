-- 524: the switch for grouped (bulk) Send Rate uploads, created OFF.
--
-- push-batch can now merge the rows of one tariff that share an upload verb and an activation
-- date into ONE Sippy upload — one token, one workbook, one poll, one read-back — instead of one
-- of each per prefix. That is the difference between 5 m 37 s and ~70 s for a five-prefix push.
-- The transport is behind platform_feature_flags.rate_push_bulk_groups, and this row makes OFF a
-- recorded fact rather than an absence convention, exactly as 520 did for the policy layer.
--
-- Nothing changes on the switch. The row is FALSE; push-batch uploads each prefix on its own,
-- exactly as it did on 2026-09-19 for Aura. Enabling it is done through the flags UI with a
-- stated reason, after the multi-row `A` workbook has been proven on the test tariff, never by
-- migration. It takes effect on the next push; no republish required.
BEGIN;

INSERT INTO platform_feature_flags (key, enabled, owner_role, reason)
VALUES (
  'rate_push_bulk_groups',
  FALSE,
  'super_admin',
  'Grouped Send Rate uploads. When ON, push-batch merges the operations of one tariff that share '
  || 'an upload verb (A/SA) and an activation date into ONE Sippy upload, with one read-back and a '
  || 'verdict recorded per prefix — the audit granularity does not change. A group of one prefix '
  || 'keeps the single-row path. When OFF, every prefix is its own upload, as before. Enable only '
  || 'after the multi-row A workbook is proven on the test tariff.'
)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE present BOOLEAN;
BEGIN
  SELECT TRUE INTO present FROM platform_feature_flags WHERE key = 'rate_push_bulk_groups';
  IF present IS NULL THEN
    RAISE EXCEPTION 'rate_push_bulk_groups flag was not registered';
  END IF;
END $$;

COMMIT;
