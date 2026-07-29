-- 050_routing_group_mapping.sql
-- The missing link between a routing package and a Sippy routing group.
--
-- routing_package_entries already holds the (country, product) grid — 12 rows for the
-- default package, 3 countries x 4 products. routing_groups_cache already holds the 23
-- routing groups synced from Sippy. Nothing joined them, so "which routing group serves
-- Pakistan First Class?" had no answer the engine could read, and an operator answered it
-- by hand in Auth Studio's dropdown for every rule.
--
-- WHY THE MAPPING IS NOT AUTO-POPULATED HERE
-- Auth Studio narrows the list by matching the destination keyword against the group NAME
-- (filterRgsByDest). That narrows; it does not decide. "Pakistan" matches three groups —
-- Pakistan, Pakistan First Class, and Pakistan First Class TALK — and which one carries a
-- given customer's First Class traffic is a routing decision with commercial consequences.
-- A migration that guessed would produce a mapping indistinguishable from one a network
-- engineer chose, and calls would silently take the wrong route.
--
-- So the columns land NULL and the engine reports "routing group not mapped" until a human
-- fills the grid. That is 12 decisions made once, not one decision per authentication rule
-- forever.
--
-- i_routing_group is the authority; routing_group_name is a cached label for display and
-- for making a stale mapping visible if a group is renamed in Sippy.
--
-- Prerequisites: 038 (routing_package_entries).
-- Idempotent.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.routing_package_entries') IS NULL THEN
    RAISE EXCEPTION 'routing_package_entries is missing — apply migration 038 first';
  END IF;
END $$;

ALTER TABLE routing_package_entries
  ADD COLUMN IF NOT EXISTS i_routing_group    INTEGER,
  ADD COLUMN IF NOT EXISTS routing_group_name VARCHAR(255);

COMMENT ON COLUMN routing_package_entries.i_routing_group IS
  'Sippy routing group serving this (country, product) cell. NULL until a network engineer maps it — never guessed from the group name, which is ambiguous (Pakistan matches three groups).';
COMMENT ON COLUMN routing_package_entries.routing_group_name IS
  'Cached display label for i_routing_group. Authority is the id; a mismatch against routing_groups_cache means the group was renamed in Sippy.';

CREATE INDEX IF NOT EXISTS routing_package_entries_group_idx
  ON routing_package_entries (i_routing_group) WHERE i_routing_group IS NOT NULL;

-- No verify block asserting the grid is filled: an unmapped grid is the expected state
-- immediately after this migration. Preflight reports unmapped cells for the company being
-- provisioned, which is where an operator can act on it.

COMMIT;
