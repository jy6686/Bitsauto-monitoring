-- Migration 027: Prefix Registry — canonical vendor prefix management
-- Creates 3 tables and seeds all 41 vendors with their pre-assigned prefixes.

CREATE TABLE IF NOT EXISTS canonical_vendors (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  vendor_prefix VARCHAR(4)   NOT NULL,
  description   TEXT,
  status        VARCHAR(20)  NOT NULL DEFAULT 'active',
  created_by    VARCHAR(128),
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_vendors_vendor_prefix_unique UNIQUE (vendor_prefix)
);

CREATE TABLE IF NOT EXISTS vendor_product_prefixes (
  id           SERIAL PRIMARY KEY,
  canonical_id INTEGER     NOT NULL REFERENCES canonical_vendors(id),
  product_code VARCHAR(1)  NOT NULL,
  product_name VARCHAR(32) NOT NULL,
  full_prefix  VARCHAR(5)  NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at   TIMESTAMP   NOT NULL DEFAULT NOW(),
  CONSTRAINT vendor_product_prefixes_full_prefix_unique UNIQUE (full_prefix)
);

CREATE TABLE IF NOT EXISTS prefix_audit_log (
  id           SERIAL PRIMARY KEY,
  action       VARCHAR(64)  NOT NULL,
  canonical_id INTEGER,
  vendor_name  VARCHAR(100),
  full_prefix  VARCHAR(10),
  performed_by VARCHAR(128),
  details      JSONB,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Seed 41 canonical vendors (ON CONFLICT = idempotent re-runs) ──────────────
INSERT INTO canonical_vendors (name, vendor_prefix, status) VALUES
  ('ASTRA',       '8040', 'active'),
  ('BICS',        '6248', 'active'),
  ('BTS',         '8035', 'active'),
  ('CENTRED',     '7127', 'active'),
  ('CITIC',       '1511', 'active'),
  ('DID-CONN',    '5708', 'active'),
  ('FTDL',        '9277', 'active'),
  ('GLOBACOM',    '6703', 'active'),
  ('GNGN',        '4185', 'active'),
  ('GTS',         '2477', 'active'),
  ('HAYO',        '3675', 'active'),
  ('HGC',         '2070', 'active'),
  ('IN2NET',      '7394', 'active'),
  ('INS-TELECOM', '9767', 'active'),
  ('JUNCTION',    '3765', 'active'),
  ('LANCKTEL',    '9524', 'active'),
  ('LETS-DIAL',   '2797', 'active'),
  ('MAINBERG',    '6821', 'active'),
  ('MANOR-IT',    '1879', 'active'),
  ('NGT',         '2592', 'active'),
  ('OMAN-TEL',    '7986', 'active'),
  ('OTEGLOBE',    '3638', 'active'),
  ('PTCL',        '8617', 'active'),
  ('QGC',         '9010', 'active'),
  ('QUICKCOM',    '6000', 'active'),
  ('SAIF',        '3536', 'active'),
  ('SHENGLITE',   '4274', 'active'),
  ('SKY-NET',     '7569', 'active'),
  ('SKY-TELECOM', '2750', 'active'),
  ('SPEEDFLOW',   '6039', 'active'),
  ('TATA',        '9034', 'active'),
  ('TELECARD',    '1500', 'active'),
  ('TELSTRA',     '7413', 'active'),
  ('TRIO-HUB',    '3278', 'active'),
  ('US-MATRIX',   '6328', 'active'),
  ('VERSCOM',     '1113', 'active'),
  ('VIA-CLOUD',   '2327', 'active'),
  ('VOVIDA',      '5246', 'active'),
  ('VOXBEAM',     '1066', 'active'),
  ('WAVECREST',   '6763', 'active'),
  ('ZONG',        '1971', 'active')
ON CONFLICT (vendor_prefix) DO NOTHING;

-- ── Seed 164 product prefixes (vendor_prefix + product_code) ──────────────────
INSERT INTO vendor_product_prefixes (canonical_id, product_code, product_name, full_prefix)
SELECT cv.id, p.product_code, p.product_name, cv.vendor_prefix || p.product_code
FROM canonical_vendors cv
CROSS JOIN (VALUES
  ('1','FC - First Class'),
  ('2','BC - Business Class'),
  ('6','SB - Special Bravo'),
  ('7','SC - Special Charlie')
) AS p(product_code, product_name)
ON CONFLICT (full_prefix) DO NOTHING;

-- ── Seed audit log entry for initial load ─────────────────────────────────────
INSERT INTO prefix_audit_log (action, vendor_name, performed_by, details)
VALUES ('bulk_seeded', 'ALL', 'system',
  '{"vendors": 41, "prefixes": 164, "source": "vendor_prefix_assignments_1780939289027.xlsx"}'::jsonb);
