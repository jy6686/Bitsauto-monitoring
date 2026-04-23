/**
 * Routing Cache Service
 *
 * Syncs Sippy routing data (Routing Groups, Destination Sets, Connections)
 * into the local PostgreSQL database every 15 minutes.
 *
 * Benefits:
 *  - All routing queries hit local DB — zero extra load on the Sippy switch
 *  - LCR Analyser, Call Flow Simulator, Routing Group viewer all read from cache
 *  - Background sync runs off the hot path — no latency added to user requests
 */

import { pool } from "./db";
import * as sippy from "./sippy";
import { storage } from "./storage";

let syncing = false;
let lastSyncAt: Date | null = null;

function sippyBase(portalUrl: string): string {
  return portalUrl.replace(/\/$/, "");
}

export async function syncRoutingCache(force = false): Promise<{ ok: boolean; message: string }> {
  if (syncing && !force) return { ok: false, message: "Sync already in progress" };

  const FIFTEEN_MIN = 15 * 60 * 1000;
  if (!force && lastSyncAt && Date.now() - lastSyncAt.getTime() < FIFTEEN_MIN) {
    return { ok: true, message: "Cache fresh — skipping sync" };
  }

  syncing = true;
  const client = await pool.connect();
  try {
    // Mark as syncing
    await client.query(
      `UPDATE routing_cache_meta SET last_sync_status='syncing' WHERE id=(SELECT MIN(id) FROM routing_cache_meta)`
    );

    const settings = await storage.getSippySettings();
    if (!settings?.portalUrl) {
      await client.query(
        `UPDATE routing_cache_meta SET last_sync_status='error', last_sync_error='Sippy not configured' WHERE id=(SELECT MIN(id) FROM routing_cache_meta)`
      );
      return { ok: false, message: "Sippy not configured" };
    }

    const username = settings.apiAdminUsername || settings.portalUsername || "";
    const password = settings.apiAdminPassword || settings.portalPassword || "";
    const portalUrl = settings.portalUrl;

    // ── 1. Sync Routing Groups ──────────────────────────────────────────────
    const rgResult = await sippy.listRoutingGroups(username, password, { portalUrl });
    let rgCount = 0;
    if (!rgResult.success) {
      console.warn(`[routing-cache] listRoutingGroups failed: ${rgResult.message}`);
    } else if (rgResult.groups.length === 0) {
      console.log(`[routing-cache] listRoutingGroups returned 0 groups (empty list from Sippy)`);
    } else {
      for (const rg of rgResult.groups) {
        const iRg = rg.iRoutingGroup ?? (rg as any).id;
        if (!iRg) continue;
        const rawJson = JSON.stringify(rg);
        await client.query(
          `INSERT INTO routing_groups_cache
             (i_routing_group, name, policy, media_relay, on_net, members_count, raw_json, cached_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
           ON CONFLICT (i_routing_group) DO UPDATE SET
             name=$2, policy=$3, media_relay=$4, on_net=$5, members_count=$6, raw_json=$7, cached_at=NOW()`,
          [
            iRg,
            rg.name ?? `RG#${iRg}`,
            rg.policy ?? null,
            rg.iMediaRelay !== null && rg.iMediaRelay !== undefined ? String(rg.iMediaRelay) : null,
            rg.disableOnnetRouting === false,
            rg.membersCount ?? 0,
            rawJson,
          ]
        );
        rgCount++;
      }
      console.log(`[routing-cache] Synced ${rgCount} routing groups`);
    }

    // ── 2. Sync Destination Sets ────────────────────────────────────────────
    let dsCount = 0;
    try {
      const dsResult = await sippy.listDestinationSets(username, password, { portalUrl });
      if (dsResult.success && dsResult.list.length > 0) {
        for (const ds of dsResult.list) {
          const iDs = ds.iDestinationSet ?? (ds as any).id;
          if (!iDs) continue;
          const rawJson = JSON.stringify(ds);
          await client.query(
            `INSERT INTO destination_sets_cache
               (i_destination_set, name, route_count, cld_translation, cli_translation, raw_json, cached_at)
             VALUES ($1,$2,$3,$4,$5,$6,NOW())
             ON CONFLICT (i_destination_set) DO UPDATE SET
               name=$2, route_count=$3, cld_translation=$4, cli_translation=$5, raw_json=$6, cached_at=NOW()`,
            [
              iDs,
              ds.name ?? `DS#${iDs}`,
              (ds as any).routeCount ?? (ds as any).routes?.length ?? 0,
              (ds as any).cldTranslationRule ?? null,
              (ds as any).cliTranslationRule ?? null,
              rawJson,
            ]
          );
          dsCount++;
        }
        console.log(`[routing-cache] Synced ${dsCount} destination sets`);
      }
    } catch (e: any) {
      console.warn("[routing-cache] Destination set sync skipped:", e.message);
    }

    // ── 3. Sync Vendor Connections ──────────────────────────────────────────
    let connCount = 0;
    try {
      const vendorsRes = await sippy.listSippyVendors(username, password, {}, portalUrl);
      if (vendorsRes.vendors?.length) {
        for (const vendor of vendorsRes.vendors) {
          if (!vendor.iVendor) continue;
          const vendorName = vendor.name ?? `Vendor#${vendor.iVendor}`;
          try {
            const { connections } = await sippy.listVendorConnections(username, password, vendor.iVendor, portalUrl);
            for (const conn of connections ?? []) {
              if (!conn.iConnection) continue;
              const rawJson = JSON.stringify(conn);
              await client.query(
                `INSERT INTO connection_vendor_cache2
                   (i_connection, name, i_vendor, vendor_name, host, protocol, blocked, raw_json, cached_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
                 ON CONFLICT (i_connection) DO UPDATE SET
                   name=$2, i_vendor=$3, vendor_name=$4, host=$5, protocol=$6, blocked=$7, raw_json=$8, cached_at=NOW()`,
                [
                  conn.iConnection,
                  conn.name ?? `Conn#${conn.iConnection}`,
                  vendor.iVendor,
                  vendorName,
                  (conn as any).host ?? (conn as any).destination?.split(":")[0] ?? null,
                  (conn as any).protocol ?? null,
                  (conn as any).blocked ?? false,
                  rawJson,
                ]
              );
              connCount++;
            }
          } catch { /* skip per-vendor failures */ }
        }
        console.log(`[routing-cache] Synced ${connCount} vendor connections`);
      }
    } catch (e: any) {
      console.warn("[routing-cache] Connection sync skipped:", e.message);
    }

    // ── Update meta ─────────────────────────────────────────────────────────
    lastSyncAt = new Date();
    await client.query(
      `UPDATE routing_cache_meta SET
         last_sync_at=NOW(), last_sync_status='ok', last_sync_error=NULL,
         rg_count=$1, ds_count=$2, conn_count=$3
       WHERE id=(SELECT MIN(id) FROM routing_cache_meta)`,
      [rgCount, dsCount, connCount]
    );

    return { ok: true, message: `Synced: ${rgCount} RGs, ${dsCount} DSets, ${connCount} conns` };
  } catch (e: any) {
    try {
      await client.query(
        `UPDATE routing_cache_meta SET last_sync_status='error', last_sync_error=$1 WHERE id=(SELECT MIN(id) FROM routing_cache_meta)`,
        [e.message]
      );
    } catch { /* ignore meta write failure */ }
    console.error("[routing-cache] Sync error:", e.message);
    return { ok: false, message: e.message };
  } finally {
    syncing = false;
    client.release();
  }
}

/** Read cached routing groups from local DB */
export async function getCachedRoutingGroups() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT i_routing_group, name, policy, media_relay, on_net, members_count, cached_at
       FROM routing_groups_cache ORDER BY name`
    );
    return res.rows;
  } finally { client.release(); }
}

/** Read cached destination sets from local DB */
export async function getCachedDestinationSets() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT i_destination_set, name, route_count, cld_translation, cli_translation, cached_at
       FROM destination_sets_cache ORDER BY name`
    );
    return res.rows;
  } finally { client.release(); }
}

/** Read cached connections from local DB */
export async function getCachedConnections() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT i_connection, name, i_vendor, vendor_name, host, protocol, blocked, cached_at
       FROM connection_vendor_cache2 ORDER BY vendor_name, name`
    );
    return res.rows;
  } finally { client.release(); }
}

/** Read sync metadata */
export async function getRoutingCacheMeta() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT last_sync_at, last_sync_status, last_sync_error, rg_count, ds_count, conn_count
       FROM routing_cache_meta ORDER BY id LIMIT 1`
    );
    return res.rows[0] ?? null;
  } finally { client.release(); }
}

/** Start background sync — runs every 15 minutes */
export function startRoutingCacheSync() {
  // Initial sync after 10 seconds (let Sippy session establish first)
  setTimeout(async () => {
    const result = await syncRoutingCache(true);
    console.log(`[routing-cache] Initial sync: ${result.message}`);
  }, 10_000);

  // Refresh every 15 minutes
  setInterval(async () => {
    const result = await syncRoutingCache(true);
    console.log(`[routing-cache] Periodic sync: ${result.message}`);
  }, 15 * 60 * 1000);
}
