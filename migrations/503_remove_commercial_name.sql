-- 503_remove_commercial_name.sql
--
-- Removes commercial_name. 502 added a business naming layer on top of the supplier
-- catalogue; the owner's rule is that the platform displays exactly what the approved
-- supplier catalogue contains, and a second naming system was not asked for. Reverting is
-- cheaper than leaving a column that invites someone to start using it.
--
-- Idempotent whether or not 502 applied: 502 may have been pushed and not yet booted.
--
-- The views go back to serving `name` alone. If a business naming layer is ever genuinely
-- needed it can be introduced deliberately — but as its own decision, not as a field that
-- happens to exist.

BEGIN;

DROP TRIGGER IF EXISTS trg_cd_rename_stamp ON commercial_destinations;
DROP FUNCTION IF EXISTS stamp_commercial_rename();
DROP INDEX IF EXISTS cd_commercial_name_unique;

DROP VIEW IF EXISTS v_catalogue_sellable_prefixes;
DROP VIEW IF EXISTS v_catalogue_sellable;

ALTER TABLE commercial_destinations DROP COLUMN IF EXISTS commercial_name;
ALTER TABLE commercial_destinations DROP COLUMN IF EXISTS renamed_by;
ALTER TABLE commercial_destinations DROP COLUMN IF EXISTS renamed_at;

CREATE VIEW v_catalogue_sellable AS
  SELECT d.id, d.name, d.version_id, v.label AS version_label
    FROM commercial_destinations d
    JOIN catalogue_versions v ON v.id = d.version_id AND v.status = 'active'
   WHERE d.approval_status = 'approved';

CREATE VIEW v_catalogue_sellable_prefixes AS
  SELECT p.destination_id, d.name, p.prefix, p.billing_increment, p.supplier_rate
    FROM commercial_destination_prefixes p
    JOIN commercial_destinations d ON d.id = p.destination_id
    JOIN catalogue_versions v      ON v.id = d.version_id AND v.status = 'active'
   WHERE d.approval_status = 'approved';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'commercial_destinations' AND column_name = 'commercial_name') THEN
    RAISE EXCEPTION '503: commercial_name still present.';
  END IF;
  RAISE NOTICE '503: commercial_name removed. The platform displays the supplier name, and only the supplier name.';
END$$;

COMMIT;
