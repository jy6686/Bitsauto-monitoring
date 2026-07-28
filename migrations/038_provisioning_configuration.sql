-- 038_provisioning_configuration.sql
-- Onboarding 2.0 — Sprint 1: configuration-driven provisioning defaults.
--
-- Three concerns, deliberately three tables rather than one profile blob: a routing
-- package is reused across several provisioning profiles, so bundling it into each
-- profile would guarantee drift the first time two profiles differed only in a billing
-- default. Countries live in DATA, never in provisioning code — adding Sri Lanka is a
-- row insert, not an engine change.
--
--   provisioning_profiles ──→ routing_packages      ──→ routing_package_entries
--                         └─→ notification_profiles ──→ notification_profile_events
--
-- Spec: docs/capabilities/ONBOARDING-2.0.md §3.2 (design frozen 2026-07-28).
-- Idempotent. Apply manually:  psql "$DATABASE_URL" -f migrations/038_provisioning_configuration.sql

BEGIN;

-- ── Routing packages ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS routing_packages (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(128) NOT NULL UNIQUE,
  description TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One row per country×product. The provisioning engine reads these; it never holds a
-- country list of its own.
CREATE TABLE IF NOT EXISTS routing_package_entries (
  id         SERIAL PRIMARY KEY,
  package_id INTEGER NOT NULL REFERENCES routing_packages(id) ON DELETE CASCADE,
  country    VARCHAR(64) NOT NULL,
  product    VARCHAR(64) NOT NULL,
  priority   INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT TRUE
);
-- Named to match shared/schema.ts exactly. An inline UNIQUE would be auto-named
-- routing_package_entries_package_id_country_product_key, which drizzle-push would not
-- recognise — the same migration/schema divergence that silently rolled back 029.
CREATE UNIQUE INDEX IF NOT EXISTS uq_routing_package_entry
  ON routing_package_entries (package_id, country, product);

-- ── Notification profiles ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_profiles (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(128) NOT NULL UNIQUE,
  description TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_profile_events (
  id         SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES notification_profiles(id) ON DELETE CASCADE,
  event_key  VARCHAR(64) NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_profile_event
  ON notification_profile_events (profile_id, event_key);

-- ── Provisioning profiles ───────────────────────────────────────────────────
-- Business + technical defaults. The engine loads one of these and overrides only the
-- few fields the operator actually supplied in the wizard.
CREATE TABLE IF NOT EXISTS provisioning_profiles (
  id                      SERIAL PRIMARY KEY,
  name                    VARCHAR(128) NOT NULL UNIQUE,
  -- Which company type this profile serves. Payment term is DERIVED from this, so it is
  -- stored rather than chosen per customer (wholesale → postpaid, retail → prepaid).
  company_type            VARCHAR(32)  NOT NULL,
  description             TEXT,
  is_default              BOOLEAN NOT NULL DEFAULT FALSE,
  active                  BOOLEAN NOT NULL DEFAULT TRUE,

  product_package         VARCHAR(32)   NOT NULL DEFAULT 'ALL',
  credit_limit            NUMERIC(12,4) NOT NULL DEFAULT 2.0000,
  billing_cycle           VARCHAR(32)   NOT NULL DEFAULT 'weekly',
  billing_cycle_days      INTEGER       NOT NULL DEFAULT 7,
  payment_term            VARCHAR(16)   NOT NULL DEFAULT 'postpaid',
  grace_period_days       INTEGER       NOT NULL DEFAULT 3,
  -- Dispute policy is "USD 100 or 1%" — both halves stored; the engine applies the
  -- governance rule rather than the number being re-decided per customer.
  dispute_value           NUMERIC(12,2) NOT NULL DEFAULT 100.00,
  dispute_pct             NUMERIC(5,2)  NOT NULL DEFAULT 1.00,

  codec_preference        VARCHAR(32)   NOT NULL DEFAULT 'auto',
  media_relay             VARCHAR(16)   NOT NULL DEFAULT 'default',
  max_cps                 INTEGER       NOT NULL DEFAULT 10,
  max_sessions            INTEGER       NOT NULL DEFAULT 10,
  invoice_template        VARCHAR(64)   NOT NULL DEFAULT 'default',

  routing_package_id      INTEGER REFERENCES routing_packages(id),
  notification_profile_id INTEGER REFERENCES notification_profiles(id),

  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Seed: routing package (owner-specified 2026-07-28) ──────────────────────
INSERT INTO routing_packages (name, description, is_default)
VALUES ('Wholesale Default', 'Standard destination coverage for new wholesale customers', TRUE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO routing_package_entries (package_id, country, product, priority)
SELECT p.id, c.country, pr.product, pr.priority
  FROM routing_packages p
 CROSS JOIN (VALUES ('Pakistan'), ('India'), ('Bangladesh')) AS c(country)
 CROSS JOIN (VALUES ('First Class', 1), ('Business Class', 2),
                    ('Special Bravo', 3), ('Special Charlie', 4)) AS pr(product, priority)
 WHERE p.name = 'Wholesale Default'
ON CONFLICT (package_id, country, product) DO NOTHING;

-- ── Seed: notification profile ──────────────────────────────────────────────
INSERT INTO notification_profiles (name, description, is_default)
VALUES ('Standard Notifications', 'Default notification set for new customers', TRUE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO notification_profile_events (profile_id, event_key, enabled)
SELECT p.id, e.event_key, TRUE
  FROM notification_profiles p
 CROSS JOIN (VALUES ('welcome'), ('rate_notification'), ('invoice'),
                    ('balance_alert'), ('traffic_trend'), ('fraud_alert'),
                    ('system')) AS e(event_key)
 WHERE p.name = 'Standard Notifications'
ON CONFLICT (profile_id, event_key) DO NOTHING;

-- ── Seed: provisioning profiles ─────────────────────────────────────────────
-- Wholesale is the default. Retail differs only in payment term today, which is exactly
-- why routing lives in its own table — both profiles point at the same package.
INSERT INTO provisioning_profiles (
  name, company_type, description, is_default, payment_term,
  routing_package_id, notification_profile_id
)
SELECT v.name, v.company_type, v.description, v.is_default, v.payment_term, rp.id, np.id
  FROM (VALUES
    ('Standard Wholesale', 'wholesale', 'Default profile for new wholesale customers', TRUE,  'postpaid'),
    ('Standard Retail',    'retail',    'Default profile for new retail customers',    FALSE, 'prepaid')
  ) AS v(name, company_type, description, is_default, payment_term)
 CROSS JOIN (SELECT id FROM routing_packages      WHERE name = 'Wholesale Default')      rp
 CROSS JOIN (SELECT id FROM notification_profiles WHERE name = 'Standard Notifications') np
ON CONFLICT (name) DO NOTHING;

-- ── Verify: fail loudly rather than leaving a half-seeded configuration ─────
DO $$
DECLARE
  entries  INTEGER;
  events   INTEGER;
  profiles INTEGER;
  unlinked INTEGER;
BEGIN
  SELECT COUNT(*) INTO entries FROM routing_package_entries e
    JOIN routing_packages p ON p.id = e.package_id WHERE p.name = 'Wholesale Default';
  IF entries <> 12 THEN
    RAISE EXCEPTION 'routing_package_entries=% (want 12 = 3 countries x 4 products)', entries;
  END IF;

  SELECT COUNT(*) INTO events FROM notification_profile_events;
  IF events < 7 THEN
    RAISE EXCEPTION 'notification_profile_events=% (want >=7)', events;
  END IF;

  SELECT COUNT(*) INTO profiles FROM provisioning_profiles;
  IF profiles < 2 THEN
    RAISE EXCEPTION 'provisioning_profiles=% (want >=2)', profiles;
  END IF;

  -- A profile with null FKs would silently provision without routing or notifications.
  SELECT COUNT(*) INTO unlinked FROM provisioning_profiles
   WHERE routing_package_id IS NULL OR notification_profile_id IS NULL;
  IF unlinked > 0 THEN
    RAISE EXCEPTION '% provisioning_profiles missing routing/notification link', unlinked;
  END IF;
END $$;

COMMIT;
