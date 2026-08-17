/**
 * Routing-group snapshot capture — the Testing Agent's read-only window into
 * routing truth (owner-ratified 2026-08-17).
 *
 * The monitoring server is the SOLE Sippy client; the Testing Agent never
 * speaks XML-RPC. This endpoint performs LIVE reads at request time (list
 * calls only) and returns the owner's capture contract verbatim. The agent
 * seals the response before origination; the supplier resolver then applies
 * its fail-closed gates.
 *
 * ── HARD BOUNDARY (Phase 2b) ───────────────────────────────────────────────
 * READ-ONLY. Nothing in this file may create, update, bind, or delete
 * anything on Sippy. The write/revert procedure for a forced-supplier window
 * is a separate, explicitly owner-authorized step — no Sippy write occurs
 * merely because this endpoint exists.
 *
 * "enabled" is DERIVED, not read: Sippy routing-group members carry no
 * enabled flag, only activation/expiration windows. A member is reported
 * enabled when `snapshotAt` falls inside its window (open ends count as
 * open). The raw dates are returned beside the derivation so the evidence
 * seal carries what was actually observed, not only our interpretation.
 */

import {
  listRoutingGroups, listRoutingGroupMembers, listSippyVendors, listSippyAccounts,
  type SippyRoutingGroupMember,
} from './sippy';

export interface RoutingSnapshotWire {
  sessionId: string;
  requestedSupplier: string;
  routingGroupId: string;
  routingGroupName: string | null;
  accountId: string;
  accountRoutingGroupId: string | null;
  accountBindingVerified: boolean;
  members: {
    vendorId: string | null;
    vendorName: string | null;
    enabled: boolean;
    preference: number | null;
    activationDate: string | null;
    expirationDate: string | null;
  }[];
  enabledMemberCount: number;
  /** The single enabled member's identity when enabledMemberCount === 1. */
  vendorId: string | null;
  vendorName: string | null;
  snapshotAt: number;
  readOnly: true;
}

const inWindow = (m: SippyRoutingGroupMember, at: number): boolean => {
  const a = m.activationDate ? Date.parse(m.activationDate) : null;
  const e = m.expirationDate ? Date.parse(m.expirationDate) : null;
  if (a != null && !Number.isNaN(a) && at < a) return false;
  if (e != null && !Number.isNaN(e) && at >= e) return false;
  return true;
};

/** Pure assembly over pre-fetched reads — vitest covers this directly. */
export function buildRoutingSnapshotResponse(i: {
  sessionId: string;
  requestedSupplier: string;
  groupId: number;
  accountId: number;
  snapshotAt: number;
  groups: { iRoutingGroup: number | null; name: string | null }[];
  members: SippyRoutingGroupMember[];
  vendors: { iVendor: number | null; name: string | null }[];
  accountRoutingGroupId: number | null | undefined;
  accountFound: boolean;
}): RoutingSnapshotWire {
  const vendorName = new Map(i.vendors.filter(v => v.iVendor != null).map(v => [v.iVendor!, v.name]));
  const group = i.groups.find(g => g.iRoutingGroup === i.groupId) ?? null;
  const members = i.members.map(m => ({
    vendorId: m.iVendor != null ? String(m.iVendor) : null,
    vendorName: m.iVendor != null ? (vendorName.get(m.iVendor) ?? null) : null,
    enabled: inWindow(m, i.snapshotAt),
    preference: m.preference,
    activationDate: m.activationDate,
    expirationDate: m.expirationDate,
  }));
  const enabled = members.filter(m => m.enabled);
  const bound = i.accountFound && i.accountRoutingGroupId != null;
  return {
    sessionId: i.sessionId,
    requestedSupplier: i.requestedSupplier,
    routingGroupId: String(i.groupId),
    routingGroupName: group?.name ?? null,
    accountId: String(i.accountId),
    accountRoutingGroupId: bound ? String(i.accountRoutingGroupId) : null,
    accountBindingVerified: bound,
    members,
    enabledMemberCount: enabled.length,
    vendorId: enabled.length === 1 ? enabled[0]!.vendorId : null,
    vendorName: enabled.length === 1 ? enabled[0]!.vendorName : null,
    snapshotAt: i.snapshotAt,
    readOnly: true,
  };
}

function creds() {
  return {
    username: process.env.SIPPY_PROV_USERNAME || process.env.PORTAL_USERNAME || '',
    password: process.env.SIPPY_PROV_PASSWORD || process.env.PORTAL_PASSWORD || '',
  };
}

export function registerRoutingSnapshotRoutes(app: any) {
  // Internal capture endpoint. Guarded by MONITORING_INTERNAL_KEY when set
  // (the Testing Agent sends it as X-Internal-Key); follows the existing
  // internal-endpoint convention otherwise.
  app.get('/api/internal/routing-snapshot', async (req: any, res: any) => {
    const requiredKey = process.env.MONITORING_INTERNAL_KEY;
    if (requiredKey && req.headers['x-internal-key'] !== requiredKey) {
      res.status(403).json({ error: 'internal key required' });
      return;
    }
    const sessionId = String(req.query.sessionId ?? '');
    const requestedSupplier = String(req.query.requestedSupplier ?? '');
    const groupId = Number(req.query.groupId);
    const accountId = Number(req.query.accountId);
    if (!sessionId || !requestedSupplier || !Number.isFinite(groupId) || !Number.isFinite(accountId)) {
      res.status(400).json({ error: 'sessionId, requestedSupplier, groupId, accountId are required' });
      return;
    }
    try {
      const { username, password } = creds();
      const snapshotAt = Date.now();

      // LIVE reads only — list calls, nothing else.
      const [groupsRes, membersRes, vendorsRes, accountsRes] = await Promise.all([
        listRoutingGroups(username, password, { iRoutingGroup: groupId }),
        listRoutingGroupMembers(username, password, groupId),
        listSippyVendors(username, password, {}),
        listSippyAccounts(username, password, {}),
      ]);
      if (!membersRes.success) {
        res.status(502).json({ error: `members read failed: ${membersRes.message}` });
        return;
      }
      const account = (accountsRes.accounts ?? []).find(a => a.iAccount === accountId) ?? null;

      res.json(buildRoutingSnapshotResponse({
        sessionId, requestedSupplier, groupId, accountId, snapshotAt,
        groups: groupsRes.groups ?? [],
        members: membersRes.members,
        vendors: vendorsRes.vendors ?? [],
        accountRoutingGroupId: account?.iRoutingGroup ?? null,
        accountFound: account != null,
      }));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
