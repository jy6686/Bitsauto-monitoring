-- 504_commercial_catalogue_navigation.sql
--
-- /commercial-catalogue has existed and been routed since the catalogue work landed. Nothing
-- links to it. It carries the two operations the catalogue workflow depends on — BULK
-- approval by name prefix, and version activation — so with no menu entry the only way to
-- approve more than one destination at a time is to know the URL and type it.
--
-- That matters now rather than cosmetically: resetting a supplier catalogue to unapproved is
-- one statement, and approving back what is actually sold is 1,344 individual clicks without
-- this page.
--
-- Sits in Catalog Tools beside Destination Catalog (sort_order 20), because it is the admin
-- half of the same thing: that page browses and approves one at a time, this one manages
-- versions and approves in bulk.

BEGIN;

INSERT INTO navigation_modules (module_key, title, icon, route, category, is_system, sort_order, group_id)
VALUES (
  'commercial_catalogue',
  'Catalogue Versions',
  'layers',
  '/commercial-catalogue',
  'products',
  FALSE,
  24,
  (SELECT id FROM navigation_groups WHERE domain_id = 'products' AND label = 'Catalog Tools')
)
-- Re-runnable, and route-correcting: if the row exists from an earlier hand-insert with a
-- different route it is repaired rather than left to point somewhere stale.
ON CONFLICT (module_key) DO UPDATE
  SET title = EXCLUDED.title,
      icon  = EXCLUDED.icon,
      route = EXCLUDED.route;

DO $$
DECLARE r RECORD;
BEGIN
  SELECT module_key, route, group_id INTO r
    FROM navigation_modules WHERE module_key = 'commercial_catalogue';
  IF r.module_key IS NULL THEN
    RAISE EXCEPTION '504: navigation row for commercial_catalogue was not created';
  END IF;
  IF r.route <> '/commercial-catalogue' THEN
    RAISE EXCEPTION '504: commercial_catalogue points at %, expected /commercial-catalogue', r.route;
  END IF;
  -- A null group is not fatal: the module still resolves, it just renders ungrouped. Said out
  -- loud rather than silently, because "the menu entry exists but is nowhere visible" is the
  -- exact failure this migration is fixing.
  IF r.group_id IS NULL THEN
    RAISE WARNING '504: Catalog Tools group not found — commercial_catalogue will render outside a group';
  END IF;
END $$;

COMMIT;
