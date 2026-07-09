/**
 * product-mapping-resolver.ts  (v3 — architecture-frozen)
 *
 * ProductMappingResolver — the single authoritative service for product-to-prefix
 * lookups throughout the commercial engine.
 *
 * CHANGES IN v3
 *   1. Longest-prefix matching       — resolve('447520123') returns match on '44752'
 *   2. Centralized normalization     — strips +, 00-prefix, spaces, dashes, parens
 *   3. Cache statistics              — hits, misses, cacheEntries, refreshDurationMs
 *   4. Refresh timing                — refreshDurationMs on last refresh
 *   5. Duplicate detection           — recorded at load time, exposed in getMetadata()
 *   6. MappingMatch return type      — matchedPrefix, strategy, sourceVersion, exactMatch
 *
 * CACHE MODEL
 *   productId → sorted prefix list (longest first) + Map<prefix, ResolvedMapping>
 *   resolve() walks the sorted list for longest-prefix match — O(k) where k = prefixes/product.
 *   resolveBulk() batches over the same logic.
 *   Cache is rebuilt atomically per product on refresh.
 *
 * PREFIX NORMALIZATION (exported for use across the commercial engine)
 *   normalizeDialPrefix('+44 7520') → '447520'
 *   normalizeDialPrefix('0044-7520') → '447520'
 *   normalizeDialPrefix('44(752)0') → '447520'
 *   All resolvers in the commercial engine must use this function.
 *
 * USAGE
 *   import { productMappingResolver, normalizeDialPrefix } from './product-mapping-resolver';
 *
 *   await productMappingResolver.init();              // once at startup
 *
 *   const match  = productMappingResolver.resolve(1, '447520123');
 *   // { mapping, matchedPrefix: '44752', strategy: 'longest_prefix', exactMatch: false, ... }
 *
 *   const bulk   = productMappingResolver.resolveBulk(2, ['9180', '447700']);
 *   const stats  = productMappingResolver.getStats();
 *   const meta   = productMappingResolver.getMetadata(1);
 */

import { db } from '../../db';
import { sql } from 'drizzle-orm';

// ── Version ───────────────────────────────────────────────────────────────────

export const PRODUCT_MAPPING_RESOLVER_VERSION = '3.0.0';

// ── Prefix normalization ──────────────────────────────────────────────────────
//
// Single canonical helper used by:
//   • ProductMappingResolver (this file)
//   • product-mapping-routes.patch.ts (upload parser)
//   • commercial-compare.service.ts (if it uses product mapping)
//   • Any future resolver that matches dial prefixes
//
// Rules applied in order:
//   1. Strip leading whitespace / tabs
//   2. Strip leading +
//   3. Strip leading 00  (international dialing prefix → normalized digit string)
//   4. Remove spaces, dashes, dots, parentheses, tabs

export function normalizeDialPrefix(prefix: string): string {
  return prefix
    .trim()
    .replace(/^\+/, '')          // strip leading +
    .replace(/^00/, '')          // strip leading 00 (international prefix)
    .replace(/[\s\-\.\(\)\t]/g, ''); // remove separators
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ResolvedMapping {
  destinationId:   number;
  destinationName: string | null;
  country:         string | null;
  operator:        string | null;
}

/**
 * Returned by resolve() and resolveBulk().
 * Mirrors the pattern already used in the tariff resolver (matchedPrefix, strategy).
 * Compare/Margin/Impact/Publish can record provenance without recomputing.
 */
export interface MappingMatch {
  mapping:        ResolvedMapping;
  /** The prefix that actually matched in the catalog (may be shorter than the dialed number) */
  matchedPrefix:  string;
  /** 'exact' when dialed number == catalog prefix; 'longest_prefix' otherwise */
  strategy:       'exact' | 'longest_prefix';
  /** True when the dialed number exactly equals the matched catalog prefix */
  exactMatch:     boolean;
  /** mapping_version_id active for this product at lookup time */
  sourceVersionId: number | null;
}

export interface ActiveVersionInfo {
  productId:        number;
  productName:      string;
  mappingVersionId: number;
  versionLabel:     string;
  activatedAt:      Date;
  prefixCount:      number;
}

export interface ResolverStats {
  cacheHits:          number;
  cacheMisses:        number;
  /** Total (product, prefix) entries currently in cache */
  cacheEntries:       number;
  productsLoaded:     number;
  lastRefreshDuration: number | null;   // ms
  loadedAt:           Date | null;
  /** Duplicate (product, prefix) pairs detected during last load */
  duplicateCount:     number;
  duplicatePrefixes:  { productId: number; prefix: string; count: number }[];
}

export interface ResolverMetadata {
  resolverVersion:  string;
  loadedAt:         Date | null;
  refreshDurationMs: number | null;
  stats:            ResolverStats;
  activeVersions: {
    productId:           number;
    productName:         string;
    mappingVersionId:    number;
    mappingVersionLabel: string;
    activatedAt:         Date;
    prefixCount:         number;
  }[];
}

// ── Internal cache entry ──────────────────────────────────────────────────────

interface ProductCache {
  /** Prefixes sorted longest-first for greedy matching */
  sortedPrefixes: string[];
  /** O(1) lookup by exact prefix */
  byPrefix:       Map<string, ResolvedMapping>;
  versionId:      number;
}

// ── Implementation ────────────────────────────────────────────────────────────

class ProductMappingResolverImpl {
  /** product_id → ProductCache */
  private cache       = new Map<number, ProductCache>();
  private versionInfo = new Map<number, ActiveVersionInfo>();

  private initialized       = false;
  private loadedAt:          Date | null   = null;
  private refreshDurationMs: number | null = null;

  // ── Stats counters ──────────────────────────────────────────────────────
  private hits       = 0;
  private misses     = 0;
  private duplicates: { productId: number; prefix: string; count: number }[] = [];

  readonly version = PRODUCT_MAPPING_RESOLVER_VERSION;

  // ── Initialization ────────────────────────────────────────────────────────

  async init(): Promise<void> {
    await this._loadAll();
    this.initialized = true;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'ProductMappingResolver not initialized. Call productMappingResolver.init() at startup.',
      );
    }
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  /**
   * Resolve a dialed prefix for a product using longest-prefix matching.
   * Returns null when no prefix in the catalog matches.
   *
   * Example:
   *   catalog has: '44752', '447'
   *   resolve(1, '447520123') → matches '44752' (longest)
   */
  resolve(productId: number, prefix: string): MappingMatch | null {
    this.ensureInitialized();
    const normalized  = normalizeDialPrefix(prefix);
    const productCache = this.cache.get(productId);

    if (!productCache) {
      this.misses++;
      return null;
    }

    const match = this._longestPrefixLookup(productCache, normalized);
    if (match === null) {
      this.misses++;
      return null;
    }

    this.hits++;
    return match;
  }

  /**
   * Resolve a batch of prefixes for a single product.
   * Returns a Map<normalizedInput, MappingMatch | null>.
   */
  resolveBulk(
    productId: number,
    prefixes:  string[],
  ): Map<string, MappingMatch | null> {
    this.ensureInitialized();
    const productCache = this.cache.get(productId);
    const result       = new Map<string, MappingMatch | null>();

    for (const prefix of prefixes) {
      const normalized = normalizeDialPrefix(prefix);
      if (!productCache) {
        this.misses++;
        result.set(normalized, null);
        continue;
      }
      const match = this._longestPrefixLookup(productCache, normalized);
      if (match) { this.hits++; } else { this.misses++; }
      result.set(normalized, match);
    }
    return result;
  }

  /**
   * Returns the destination_id for a prefix, or null.
   * Convenience wrapper for callers that only need the ID.
   */
  resolveDestinationId(productId: number, prefix: string): number | null {
    return this.resolve(productId, prefix)?.mapping.destinationId ?? null;
  }

  /**
   * Check whether a product has any active mapping at all.
   */
  hasActiveMapping(productId: number): boolean {
    this.ensureInitialized();
    return this.cache.has(productId);
  }

  /**
   * Return the currently active version info for a product.
   */
  getActiveVersion(productId: number): ActiveVersionInfo | null {
    this.ensureInitialized();
    return this.versionInfo.get(productId) ?? null;
  }

  getAllActiveVersions(): ActiveVersionInfo[] {
    this.ensureInitialized();
    return [...this.versionInfo.values()];
  }

  getPrefixes(productId: number): string[] {
    this.ensureInitialized();
    return this.cache.get(productId)?.sortedPrefixes ?? [];
  }

  // ── Stats & Metadata ──────────────────────────────────────────────────────

  getStats(): ResolverStats {
    let cacheEntries = 0;
    for (const pc of this.cache.values()) {
      cacheEntries += pc.byPrefix.size;
    }
    return {
      cacheHits:           this.hits,
      cacheMisses:         this.misses,
      cacheEntries,
      productsLoaded:      this.cache.size,
      lastRefreshDuration: this.refreshDurationMs,
      loadedAt:            this.loadedAt,
      duplicateCount:      this.duplicates.length,
      duplicatePrefixes:   this.duplicates,
    };
  }

  /**
   * Returns resolver-level metadata for Compare, Margin, Impact and Publish.
   * Includes stats so callers can embed mapping provenance in result snapshots
   * without extra DB queries.
   *
   * If productId is provided, activeVersions is filtered to that product.
   */
  getMetadata(productId?: number): ResolverMetadata {
    this.ensureInitialized();
    const all      = [...this.versionInfo.values()];
    const filtered = productId !== undefined
      ? all.filter(v => v.productId === productId)
      : all;

    return {
      resolverVersion:   this.version,
      loadedAt:          this.loadedAt,
      refreshDurationMs: this.refreshDurationMs,
      stats:             this.getStats(),
      activeVersions:    filtered.map(v => ({
        productId:           v.productId,
        productName:         v.productName,
        mappingVersionId:    v.mappingVersionId,
        mappingVersionLabel: v.versionLabel,
        activatedAt:         v.activatedAt,
        prefixCount:         v.prefixCount,
      })),
    };
  }

  /** Reset hit/miss counters (e.g. at the start of a Compare run). */
  resetStats(): void {
    this.hits   = 0;
    this.misses = 0;
  }

  // ── Cache management ──────────────────────────────────────────────────────

  async refresh(productIds?: number[]): Promise<void> {
    if (!productIds || productIds.length === 0) {
      await this._loadAll();
      return;
    }

    const t0   = Date.now();
    const rows = await db.execute(sql`
      SELECT
        pdm.product_id,
        pdm.dial_prefix_normalized,
        pdm.destination_id,
        gd.name          AS destination_name,
        gd.country_code  AS country,
        gd.operator_name AS operator,
        pmac.mapping_version_id,
        pmv.label        AS version_label,
        pmac.activated_at,
        p.name           AS product_name
      FROM   product_destination_mappings       pdm
      JOIN   product_mapping_active_config      pmac
          ON pmac.product_id          = pdm.product_id
         AND pmac.mapping_version_id  = pdm.mapping_version_id
      JOIN   product_registry                   p    ON p.id   = pdm.product_id
      JOIN   product_mapping_versions           pmv  ON pmv.id = pdm.mapping_version_id
      LEFT JOIN global_destinations             gd   ON gd.id  = pdm.destination_id
      WHERE  pdm.product_id       = ANY(${productIds}::integer[])
        AND  pdm.resolution_status = 'resolved'
        AND  (pdm.effective_from IS NULL OR pdm.effective_from <= CURRENT_DATE)
        AND  (pdm.effective_to   IS NULL OR pdm.effective_to   >= CURRENT_DATE)
    `);

    // Clear only the affected products before repopulating
    for (const productId of productIds) {
      this.cache.delete(productId);
      this.versionInfo.delete(productId);
    }

    const { dupes } = this._populateFromRows(rows.rows as any[]);
    // Merge duplicates with those from other products still in cache
    this.duplicates = [
      ...this.duplicates.filter(d => !productIds.includes(d.productId)),
      ...dupes,
    ];
    this.refreshDurationMs = Date.now() - t0;
    this.loadedAt          = new Date();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async _loadAll(): Promise<void> {
    const t0   = Date.now();
    const rows = await db.execute(sql`
      SELECT
        pdm.product_id,
        pdm.dial_prefix_normalized,
        pdm.destination_id,
        gd.name          AS destination_name,
        gd.country_code  AS country,
        gd.operator_name AS operator,
        pmac.mapping_version_id,
        pmv.label        AS version_label,
        pmac.activated_at,
        p.name           AS product_name,
        COUNT(*) OVER (PARTITION BY pdm.product_id) AS product_prefix_count
      FROM   product_destination_mappings       pdm
      JOIN   product_mapping_active_config      pmac
          ON pmac.product_id          = pdm.product_id
         AND pmac.mapping_version_id  = pdm.mapping_version_id
      JOIN   product_registry                   p    ON p.id   = pdm.product_id
      JOIN   product_mapping_versions           pmv  ON pmv.id = pdm.mapping_version_id
      LEFT JOIN global_destinations             gd   ON gd.id  = pdm.destination_id
      WHERE  pdm.resolution_status = 'resolved'
        AND  (pdm.effective_from IS NULL OR pdm.effective_from <= CURRENT_DATE)
        AND  (pdm.effective_to   IS NULL OR pdm.effective_to   >= CURRENT_DATE)
    `);

    // Build new maps, then atomically swap
    const newCache       = new Map<number, ProductCache>();
    const newVersionInfo = new Map<number, ActiveVersionInfo>();
    const { dupes }      = this._populateFromRows(rows.rows as any[], newCache, newVersionInfo);

    this.cache             = newCache;
    this.versionInfo       = newVersionInfo;
    this.duplicates        = dupes;
    this.refreshDurationMs = Date.now() - t0;
    this.loadedAt          = new Date();
  }

  /**
   * Populates cache + versionInfo from raw DB rows.
   * Detects duplicates: same (product_id, normalized_prefix) appearing more than once.
   * Returns detected duplicates for storage in this.duplicates.
   */
  private _populateFromRows(
    rows:        any[],
    cache        = this.cache,
    versionInfo  = this.versionInfo,
  ): { dupes: { productId: number; prefix: string; count: number }[] } {
    // Count occurrences for duplicate detection
    const occurrences = new Map<string, number>();  // "productId:prefix" → count

    for (const row of rows) {
      const { product_id, dial_prefix_normalized } = row;
      const key = `${product_id}:${dial_prefix_normalized}`;
      occurrences.set(key, (occurrences.get(key) ?? 0) + 1);

      // Only insert the first occurrence (duplicates are logged, not silently overwritten)
      if ((occurrences.get(key) ?? 0) > 1) continue;

      if (!cache.has(product_id)) {
        cache.set(product_id, {
          sortedPrefixes: [],
          byPrefix:       new Map(),
          versionId:      row.mapping_version_id,
        });
      }

      const pc = cache.get(product_id)!;
      pc.byPrefix.set(dial_prefix_normalized, {
        destinationId:   row.destination_id,
        destinationName: row.destination_name ?? null,
        country:         row.country          ?? null,
        operator:        row.operator         ?? null,
      });

      if (!versionInfo.has(product_id)) {
        versionInfo.set(product_id, {
          productId:        product_id,
          productName:      row.product_name,
          mappingVersionId: row.mapping_version_id,
          versionLabel:     row.version_label,
          activatedAt:      new Date(row.activated_at),
          prefixCount:      parseInt(row.product_prefix_count ?? '0'),
        });
      }
    }

    // Sort each product's prefix list longest-first (for greedy matching)
    for (const pc of cache.values()) {
      pc.sortedPrefixes = [...pc.byPrefix.keys()].sort((a, b) => b.length - a.length);
    }

    // Collect duplicates
    const dupes: { productId: number; prefix: string; count: number }[] = [];
    for (const [key, count] of occurrences) {
      if (count > 1) {
        const [pidStr, prefix] = key.split(':');
        dupes.push({ productId: parseInt(pidStr), prefix, count });
      }
    }
    return { dupes };
  }

  /**
   * Longest-prefix lookup within a single product's cache.
   * Walks sortedPrefixes (longest first) and returns the first match.
   * Returns null if no catalog prefix is a prefix of the dialed number.
   */
  private _longestPrefixLookup(pc: ProductCache, normalized: string): MappingMatch | null {
    for (const catalogPrefix of pc.sortedPrefixes) {
      if (normalized.startsWith(catalogPrefix)) {
        const mapping = pc.byPrefix.get(catalogPrefix)!;
        return {
          mapping,
          matchedPrefix:   catalogPrefix,
          strategy:        normalized === catalogPrefix ? 'exact' : 'longest_prefix',
          exactMatch:      normalized === catalogPrefix,
          sourceVersionId: pc.versionId,
        };
      }
    }
    return null;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
//
// Import and call .init() once after DB is ready (server startup).
// Use the singleton throughout the commercial engine — do not instantiate directly.

export const productMappingResolver = new ProductMappingResolverImpl();

// ── CommercialCacheCoordinator integration ────────────────────────────────────
//
// DO NOT call productMappingResolver.refresh() directly from routes.
// All cache invalidation flows through CommercialCacheCoordinator so that
// ProductMappingResolver, CommercialContext, Compare, Margin, and Impact
// caches are all refreshed consistently from a single call site.
//
// In commercial-cache-coordinator.ts:
//
//   async refreshProductMapping(productIds: number[]): Promise<void> {
//     await productMappingResolver.refresh(productIds);
//     await this.commercialContextCache.invalidateByProducts(productIds);
//     await this.compareCache.invalidate();
//     // Margin/Impact caches invalidate lazily on next request
//   }
//
// The activation route calls:
//   await commercialCacheCoordinator.refreshProductMapping(targetProductIds);
