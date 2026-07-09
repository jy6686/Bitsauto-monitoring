-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: product_mapping_catalog  (v2 — architecture-reviewed)
-- Date: 2026-07-09
--
-- WHAT THIS IS
--   A versioned Product-to-Destination Mapping layer that sits on top of the
--   existing Global Code Set (destination_catalog_versions / global_destinations).
--
-- WHAT THIS IS NOT
--   This migration does NOT modify any existing table.
--   global_destinations, destination_catalog_versions, destination_approval_history,
--   vendor_rate_sheets, sippy_tariffs — all untouched.
--
-- TWO IMPORT MODES ON THE GLOBAL CODE SET PAGE
--   1. Global Reference Catalog (existing, unchanged)
--      Source of truth for destination metadata.
--      → destination_catalog_versions + global_destinations
--
--   2. Product Mapping Catalog (new — this file)
--      Maps numeric product IDs to dial prefixes.
--      → product_mapping_versions + product_destination_mappings
--
-- PRODUCT IDENTITY
--   product_id is a FK → product_registry.id.
--   Product names come from the product_registry table at display time.
--   Numeric IDs are the authoritative identifier — names never stored here.
--   Upload files must include a numeric product_id column.
--   The platform is product-agnostic; IDs are resolved from the product_registry table.
--   Confirmed IDs: First Class=1, Business Class=2, Special Bravo=3, Special Charlie=4.
--
-- PREFIX NORMALIZATION
--   Both original and normalized prefix are stored.
--   Normalization (strip leading +, trim whitespace) happens once at import.
--   All queries match on dial_prefix_normalized.
--
-- ACTIVATION MODEL
--   Each product independently tracks its active mapping version.
--   product_mapping_active_config stores one row per product.
--   Activating "Product 1 from Version 7" = UPSERT on that table.
--   This allows different products to be on different versions simultaneously.
--
-- STATUS LIFECYCLE
--   draft → pending_validation → validated → active → superseded → archived
--
-- IDEMPOTENT — safe to re-run:
--   CREATE TABLE IF NOT EXISTS
--   CREATE INDEX IF NOT EXISTS
--   CREATE OR REPLACE VIEW
-- ─────────────────────────────────────────────────────────────────────────────


-- ── Step 1: Product mapping versions ─────────────────────────────────────────
--
-- One row per uploaded file.
-- The raw file blob is stored separately in product_mapping_files (Step 2).

CREATE TABLE IF NOT EXISTS product_mapping_versions (
  id              BIGSERIAL     PRIMARY KEY,

  -- Human label — user-supplied or auto-generated at upload time
  label           TEXT          NOT NULL,

  -- Original filename (display only; blob is in product_mapping_files)
  source_file     TEXT          NOT NULL,

  -- SHA-256 of the raw file bytes — duplicate-upload detection
  sha256          TEXT,

  -- ── Lifecycle ─────────────────────────────────────────────────────────
  -- draft              — created but not yet submitted for validation
  -- pending_validation — validation triggered, in progress
  -- validated          — validation complete, ready to activate
  -- active             — at least one product activated from this version
  -- superseded         — all products moved to a newer version
  -- archived           — manually retired, never to be activated again
  status          TEXT          NOT NULL DEFAULT 'draft'
                  CHECK (status IN (
                    'draft', 'pending_validation', 'validated',
                    'active', 'superseded', 'archived'
                  )),

  -- ── Upload statistics (populated after parse) ──────────────────────────
  row_count       INTEGER       NOT NULL DEFAULT 0,
  product_count   INTEGER       NOT NULL DEFAULT 0,   -- distinct product_ids
  prefix_count    INTEGER       NOT NULL DEFAULT 0,   -- distinct normalized prefixes

  -- ── Structured validation report ──────────────────────────────────────
  -- Shape:
  -- {
  --   summary: { total, valid, skipped, warnings, errors },
  --   errors:  [{ row, productId, prefix, reason }],
  --   warnings:[{ row, productId, prefix, reason }],
  --   unknownPrefixes: ["447520", ...],   -- in file but not in active catalog
  --   unknownProducts: [99, 103, ...],    -- product_ids not in product_registry table
  --   duplicates: [{ productId, prefix, rows:[4,17] }],
  --   orphanProducts: [1, 6, ...]         -- in active config but absent from this file
  -- }
  validation_report JSONB,

  -- ── Version fingerprint ────────────────────────────────────────────────
  -- Records which catalog and engine versions were current at import time.
  -- Mirrors the versioning pattern in commercial-margin.service.ts.
  catalog_version        TEXT,   -- active destination_catalog_versions.id at import
  mapping_engine_version TEXT,   -- ProductMappingResolver.VERSION constant
  parser_version         TEXT,   -- file parser version
  resolver_version       TEXT,   -- prefix resolver version

  -- ── Who ───────────────────────────────────────────────────────────────
  uploaded_by     TEXT,           -- user ID
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  validated_at    TIMESTAMPTZ,
  activated_at    TIMESTAMPTZ,    -- timestamp of first product activation
  superseded_at   TIMESTAMPTZ,
  archived_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pmv_status     ON product_mapping_versions(status);
CREATE INDEX IF NOT EXISTS idx_pmv_created_at ON product_mapping_versions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pmv_sha256     ON product_mapping_versions(sha256)
  WHERE sha256 IS NOT NULL;


-- ── Step 2: Original upload file storage ─────────────────────────────────────
--
-- Stores the raw file blob so operators can download the original months later.
-- Split from the versions table so list queries don't pull blob data.

CREATE TABLE IF NOT EXISTS product_mapping_files (
  id                  BIGSERIAL     PRIMARY KEY,
  mapping_version_id  BIGINT        NOT NULL UNIQUE
                      REFERENCES product_mapping_versions(id) ON DELETE CASCADE,
  filename            TEXT          NOT NULL,
  mime_type           TEXT          NOT NULL
                      DEFAULT 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size_bytes          BIGINT,
  sha256              TEXT,
  blob                BYTEA         NOT NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);


-- ── Step 3: Product destination mapping rows ──────────────────────────────────
--
-- PRODUCT IDENTITY
--   product_id is the canonical FK to product_registry.id.
--   Product names are never stored here — resolved at display time from product_registry.
--
-- PREFIX STORAGE
--   dial_prefix_original:  exactly as it appeared in the upload file
--   dial_prefix_normalized: leading + stripped, whitespace trimmed
--   All matching uses dial_prefix_normalized.
--
-- RESOLUTION STATUS
--   resolved            — destination_id found in active global_destinations
--   missing_destination — prefix not in active catalog (destination_id NULL)
--   duplicate           — same (version, product_id, normalized_prefix) appears >1×
--   ambiguous           — prefix matches multiple destinations

CREATE TABLE IF NOT EXISTS product_destination_mappings (
  id                      BIGSERIAL     PRIMARY KEY,
  mapping_version_id      BIGINT        NOT NULL
                          REFERENCES product_mapping_versions(id) ON DELETE CASCADE,

  -- ── Product ─────────────────────────────────────────────────────────────
  product_id              INTEGER       NOT NULL
                          REFERENCES product_registry(id),

  -- Snapshot of product_registry.name at import time.
  -- If a product is later renamed, historical versions remain readable.
  -- The FK (product_id) is still authoritative; this is display-only.
  product_name_snapshot   TEXT          NOT NULL,

  -- ── Prefix ──────────────────────────────────────────────────────────────
  dial_prefix_original    TEXT          NOT NULL,
  dial_prefix_normalized  TEXT          NOT NULL,

  -- ── Destination resolution ───────────────────────────────────────────────
  destination_id          INTEGER
                          REFERENCES global_destinations(id) ON DELETE SET NULL,

  resolution_status       TEXT          NOT NULL DEFAULT 'resolved'
                          CHECK (resolution_status IN (
                            'resolved', 'missing_destination', 'duplicate', 'ambiguous'
                          )),

  -- ── Effective dates ──────────────────────────────────────────────────────
  effective_from          DATE,
  effective_to            DATE,

  -- ── Provenance ───────────────────────────────────────────────────────────
  source_row              INTEGER
);

-- Primary lookup: product + prefix within a version
CREATE INDEX IF NOT EXISTS idx_pdm_version_product_prefix
  ON product_destination_mappings(mapping_version_id, product_id, dial_prefix_normalized);

-- Reverse: all products a normalized prefix appears in (across versions)
CREATE INDEX IF NOT EXISTS idx_pdm_prefix_normalized
  ON product_destination_mappings(dial_prefix_normalized);

-- Lookup by destination
CREATE INDEX IF NOT EXISTS idx_pdm_destination_id
  ON product_destination_mappings(destination_id)
  WHERE destination_id IS NOT NULL;

-- Effective-date range queries (future routing will use CURRENT_DATE often)
CREATE INDEX IF NOT EXISTS idx_pdm_effective_dates
  ON product_destination_mappings(mapping_version_id, product_id, effective_from, effective_to)
  WHERE effective_from IS NOT NULL OR effective_to IS NOT NULL;

-- Hot path for ProductMappingResolver cache refresh (resolved rows only)
CREATE INDEX IF NOT EXISTS idx_pdm_resolved
  ON product_destination_mappings(product_id, dial_prefix_normalized)
  WHERE resolution_status = 'resolved';


-- ── Step 4: Per-product active configuration ──────────────────────────────────
--
-- Each product independently tracks which version is currently active for it.
-- This replaces the single "WHERE status = 'active'" pattern.
--
-- Examples:
--   product_id 1 (First Class)     → mapping_version_id 7
--   product_id 2 (Business Class)  → mapping_version_id 5
--   product_id 3 (Special Bravo)   → mapping_version_id 9
--
-- Activation = UPSERT (INSERT … ON CONFLICT (product_id) DO UPDATE …)
-- Rollback   = UPSERT to an older version_id — no special rollback endpoint needed.

CREATE TABLE IF NOT EXISTS product_mapping_active_config (
  product_id          INTEGER       NOT NULL PRIMARY KEY
                      REFERENCES product_registry(id),
  mapping_version_id  BIGINT        NOT NULL
                      REFERENCES product_mapping_versions(id),
  activated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  activated_by        TEXT          -- user ID
);

CREATE INDEX IF NOT EXISTS idx_pmac_version_id
  ON product_mapping_active_config(mapping_version_id);


-- ── Step 5: Active mappings view ─────────────────────────────────────────────
--
-- Joins through product_mapping_active_config (not a status flag).
-- Returns only resolved rows within their effective date window.
-- This is the primary read interface for ProductMappingResolver.

CREATE OR REPLACE VIEW active_product_destination_mappings AS
  SELECT
    pdm.id,
    pdm.product_id,
    p.name                      AS product_name,
    pdm.dial_prefix_original,
    pdm.dial_prefix_normalized,
    pdm.destination_id,
    gd.name                     AS destination_name,
    gd.country_code             AS country,
    gd.operator_name            AS operator,
    gd.commercial_status        AS destination_status,
    pdm.effective_from,
    pdm.effective_to,
    pmac.mapping_version_id,
    pmv.label                   AS mapping_version_label,
    pmac.activated_at
  FROM   product_destination_mappings     pdm
  JOIN   product_mapping_active_config    pmac
      ON pmac.product_id         = pdm.product_id
     AND pmac.mapping_version_id = pdm.mapping_version_id
  JOIN   product_registry                 p    ON p.id   = pdm.product_id
  LEFT JOIN global_destinations           gd   ON gd.id  = pdm.destination_id
  JOIN   product_mapping_versions         pmv  ON pmv.id = pdm.mapping_version_id
  WHERE  pdm.resolution_status = 'resolved'
    AND  (pdm.effective_from IS NULL OR pdm.effective_from <= CURRENT_DATE)
    AND  (pdm.effective_to   IS NULL OR pdm.effective_to   >= CURRENT_DATE);


-- ── Step 6: Audit log ─────────────────────────────────────────────────────────
--
-- One row per lifecycle event.
-- product_id IS NULL = whole-version event (e.g. archive, restore).
-- from_version_id captures what was previously active (for rollback traceability).
--
-- actions: activate | rollback | supersede | archive | restore

CREATE TABLE IF NOT EXISTS product_mapping_activation_log (
  id                  BIGSERIAL     PRIMARY KEY,
  mapping_version_id  BIGINT        NOT NULL
                      REFERENCES product_mapping_versions(id),
  product_id          INTEGER                         -- NULL = whole-version event
                      REFERENCES product_registry(id),
  action              TEXT          NOT NULL
                      CHECK (action IN (
                        'activate', 'rollback', 'supersede', 'archive', 'restore'
                      )),
  from_version_id     BIGINT,       -- previously active version (for rollback trace)
  performed_by        TEXT,         -- user ID
  performed_by_name   TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pmal_version_id  ON product_mapping_activation_log(mapping_version_id);
CREATE INDEX IF NOT EXISTS idx_pmal_product_id  ON product_mapping_activation_log(product_id);
CREATE INDEX IF NOT EXISTS idx_pmal_created_at  ON product_mapping_activation_log(created_at DESC);


-- ── Verification queries ───────────────────────────────────────────────────────
--
-- After applying the migration:
--   SELECT status, COUNT(*) FROM product_mapping_versions GROUP BY 1;
--
-- After first import:
--   SELECT p.name, pmac.mapping_version_id, pmac.activated_at
--   FROM   product_mapping_active_config pmac
--   JOIN   product_registry p ON p.id = pmac.product_id
--   ORDER  BY p.name;
--
--   SELECT product_name, COUNT(*) AS prefixes
--   FROM   active_product_destination_mappings
--   GROUP  BY product_name ORDER BY 2 DESC;
--
--   SELECT resolution_status, COUNT(*)
--   FROM   product_destination_mappings
--   WHERE  mapping_version_id = <id>
--   GROUP  BY 1;
