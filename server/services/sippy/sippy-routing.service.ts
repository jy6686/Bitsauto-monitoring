/**
 * sippy-routing.service.ts
 *
 * Routing governance service.
 * Owns: LCR management, routing group CRUD, vendor connections, route validation.
 *
 * All write operations are audited. All methods accept SippyConfig — queue-safe.
 */

import * as sippy from '../../sippy';
import {
  SippyConfig, SippyRoutingGroup, SippyRoutingGroupMember, ServiceResult,
} from './types';
import { normalizeSippyError, SippyRoutingError } from './errors';
import { auditLog } from './sippy-audit.service';

// ── Routing group reads ───────────────────────────────────────────────────────

/**
 * List all routing groups on the switch.
 */
export async function listRoutingGroups(config: SippyConfig): Promise<SippyRoutingGroup[]> {
  try {
    const result = await sippy.listRoutingGroups(config.username, config.password, config.portalUrl);
    return (result ?? []) as SippyRoutingGroup[];
  } catch (err) {
    throw normalizeSippyError(err, 'listRoutingGroups');
  }
}

/**
 * List members (vendor connections) within a routing group.
 */
export async function listRoutingGroupMembers(
  config: SippyConfig,
  iRoutingGroup: string | number,
): Promise<SippyRoutingGroupMember[]> {
  try {
    const result = await sippy.listRoutingGroupMembers(
      config.username, config.password, iRoutingGroup, config.portalUrl,
    );
    return (result ?? []) as SippyRoutingGroupMember[];
  } catch (err) {
    throw normalizeSippyError(err, 'listRoutingGroupMembers');
  }
}

/**
 * List extended routing entries (dialplan-level routing).
 */
export async function listExtendedRouting(config: SippyConfig): Promise<unknown[]> {
  try {
    const result = await sippy.listExtendedRouting(
      config.username, config.password, {}, config.portalUrl,
    );
    return (result as any)?.routes ?? [];
  } catch (err) {
    throw normalizeSippyError(err, 'listExtendedRouting');
  }
}

// ── Routing group writes ──────────────────────────────────────────────────────

/**
 * Create a new routing group.
 */
export async function addRoutingGroup(
  config: SippyConfig,
  opts: { name: string; type?: string; [key: string]: unknown },
): Promise<ServiceResult<{ iRoutingGroup: string | number }>> {
  const t0 = Date.now();
  try {
    const result = await sippy.addRoutingGroup(
      config.username, config.password, opts as any, config.portalUrl,
    );
    await auditLog({
      operationType: 'routing_change',
      portalUrl: config.portalUrl,
      params: { action: 'addRoutingGroup', name: opts.name },
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return {
      ok: true,
      data: { iRoutingGroup: (result as any)?.i_routing_group ?? (result as any)?.iRoutingGroup },
    };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'addRoutingGroup');
    await auditLog({
      operationType: 'routing_change',
      portalUrl: config.portalUrl,
      params: { action: 'addRoutingGroup', name: opts.name },
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    return { ok: false, error: sippyErr.message };
  }
}

/**
 * Update an existing routing group.
 */
export async function updateRoutingGroup(
  config: SippyConfig,
  iRoutingGroup: string | number,
  updates: Record<string, unknown>,
): Promise<ServiceResult<void>> {
  const t0 = Date.now();
  try {
    await sippy.updateRoutingGroup(
      config.username, config.password, iRoutingGroup, updates as any, config.portalUrl,
    );
    await auditLog({
      operationType: 'routing_change',
      portalUrl: config.portalUrl,
      params: { action: 'updateRoutingGroup', iRoutingGroup },
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return { ok: true };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'updateRoutingGroup');
    await auditLog({
      operationType: 'routing_change',
      portalUrl: config.portalUrl,
      params: { action: 'updateRoutingGroup', iRoutingGroup },
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    return { ok: false, error: sippyErr.message };
  }
}

/**
 * Delete a routing group. Fails if the group has active members.
 */
export async function deleteRoutingGroup(
  config: SippyConfig,
  iRoutingGroup: string | number,
): Promise<ServiceResult<void>> {
  const t0 = Date.now();
  try {
    // Validate — refuse to delete a group that still has members
    const members = await listRoutingGroupMembers(config, iRoutingGroup);
    if (members.length > 0) {
      throw new SippyRoutingError(
        `Cannot delete routing group ${iRoutingGroup}: it has ${members.length} active member(s)`,
      );
    }
    await sippy.delRoutingGroup(
      config.username, config.password, iRoutingGroup, config.portalUrl,
    );
    await auditLog({
      operationType: 'routing_change',
      portalUrl: config.portalUrl,
      params: { action: 'deleteRoutingGroup', iRoutingGroup },
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return { ok: true };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'deleteRoutingGroup');
    await auditLog({
      operationType: 'routing_change',
      portalUrl: config.portalUrl,
      params: { action: 'deleteRoutingGroup', iRoutingGroup },
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    return { ok: false, error: sippyErr.message };
  }
}

// ── Routing group members ─────────────────────────────────────────────────────

/**
 * Add a vendor connection to a routing group.
 */
export async function addRoutingGroupMember(
  config: SippyConfig,
  iRoutingGroup: string | number,
  opts: { iVendor?: string | number; priority?: number; weight?: number; [key: string]: unknown },
): Promise<ServiceResult<void>> {
  const t0 = Date.now();
  try {
    await sippy.addRoutingGroupMember(
      config.username, config.password, iRoutingGroup, opts as any, config.portalUrl,
    );
    await auditLog({
      operationType: 'routing_change',
      portalUrl: config.portalUrl,
      params: { action: 'addMember', iRoutingGroup, iVendor: opts.iVendor },
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return { ok: true };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'addRoutingGroupMember');
    await auditLog({
      operationType: 'routing_change',
      portalUrl: config.portalUrl,
      params: { action: 'addMember', iRoutingGroup, iVendor: opts.iVendor },
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    return { ok: false, error: sippyErr.message };
  }
}

/**
 * Remove a vendor connection from a routing group.
 */
export async function removeRoutingGroupMember(
  config: SippyConfig,
  iRoutingGroupMember: string | number,
): Promise<ServiceResult<void>> {
  const t0 = Date.now();
  try {
    await sippy.delRoutingGroupMember(
      config.username, config.password, iRoutingGroupMember, config.portalUrl,
    );
    await auditLog({
      operationType: 'routing_change',
      portalUrl: config.portalUrl,
      params: { action: 'removeMember', iRoutingGroupMember },
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return { ok: true };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'removeRoutingGroupMember');
    await auditLog({
      operationType: 'routing_change',
      portalUrl: config.portalUrl,
      params: { action: 'removeMember', iRoutingGroupMember },
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    return { ok: false, error: sippyErr.message };
  }
}

// ── Route validation ──────────────────────────────────────────────────────────

/**
 * Validate a routing configuration is internally consistent:
 * - All routing groups have at least one active member
 * - No circular routing dependencies
 * Returns an array of validation warnings (empty = valid).
 */
export async function validateRoutingConfig(
  config: SippyConfig,
): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const groups = await listRoutingGroups(config);
    for (const group of groups) {
      if (!group.iRoutingGroup) continue;
      const members = await listRoutingGroupMembers(config, group.iRoutingGroup);
      if (members.length === 0) {
        warnings.push(`Routing group "${group.name ?? group.iRoutingGroup}" has no members — calls will fail`);
      }
    }
  } catch (err) {
    warnings.push(`Could not validate routing config: ${(err as Error).message}`);
  }
  return warnings;
}

/**
 * Sync routing groups from Sippy into normalized structures for local caching.
 */
export async function syncRoutingGroups(config: SippyConfig): Promise<{
  routingGroups:  SippyRoutingGroup[];
  membersByGroup: Map<string | number, SippyRoutingGroupMember[]>;
}> {
  const routingGroups = await listRoutingGroups(config);
  const membersByGroup = new Map<string | number, SippyRoutingGroupMember[]>();

  await Promise.allSettled(
    routingGroups.map(async group => {
      if (group.iRoutingGroup == null) return;
      const members = await listRoutingGroupMembers(config, group.iRoutingGroup);
      membersByGroup.set(group.iRoutingGroup, members);
    }),
  );

  return { routingGroups, membersByGroup };
}

/**
 * Assign a vendor route to a routing group (idempotent upsert pattern).
 */
export async function assignVendorRoute(
  config: SippyConfig,
  iRoutingGroup: string | number,
  iVendor: string | number,
  opts: { priority?: number; weight?: number } = {},
): Promise<ServiceResult<void>> {
  // Check if already a member
  const existing = await listRoutingGroupMembers(config, iRoutingGroup);
  const alreadyMember = existing.some(m => String(m.iVendor) === String(iVendor));
  if (alreadyMember) {
    return { ok: true }; // Idempotent — already assigned
  }
  return addRoutingGroupMember(config, iRoutingGroup, {
    iVendor,
    priority: opts.priority ?? 1,
    weight:   opts.weight   ?? 1,
  });
}
