/**
 * Routing-snapshot capture — the pure assembly pinned. The wire contract is
 * evidence; every derivation here must be visible in what it returns.
 */

import { describe, it, expect } from 'vitest';
import { buildRoutingSnapshotResponse } from './routes-routing-snapshot';
import type { SippyRoutingGroupMember } from './sippy';

const member = (o: Partial<SippyRoutingGroupMember> = {}): SippyRoutingGroupMember => ({
  iRoutingGroupMember: 1, iRoutingGroup: 77, iConnection: 10, iVendor: 5,
  iConnectionGroup: null, iDestinationSet: null, preference: 100,
  activationDate: null, expirationDate: null, weight: null, stirShakenAsMode: null, ...o,
});
const base = {
  sessionId: 'AT-1', requestedSupplier: 'Supplier A', groupId: 77, accountId: 9,
  snapshotAt: 1_000_000,
  groups: [{ iRoutingGroup: 77, name: 'BTA-FORCE-A' }],
  vendors: [{ iVendor: 5, name: 'Supplier A' }, { iVendor: 6, name: 'Supplier B' }],
  accountRoutingGroupId: 77 as number | null,
  accountFound: true,
};

describe('buildRoutingSnapshotResponse', () => {
  it('the single-member group produces the complete owner contract', () => {
    const r = buildRoutingSnapshotResponse({ ...base, members: [member()] });
    expect(r).toMatchObject({
      sessionId: 'AT-1', requestedSupplier: 'Supplier A',
      routingGroupId: '77', routingGroupName: 'BTA-FORCE-A',
      accountId: '9', accountRoutingGroupId: '77', accountBindingVerified: true,
      enabledMemberCount: 1, vendorId: '5', vendorName: 'Supplier A',
      snapshotAt: 1_000_000, readOnly: true,
    });
    expect(r.members).toHaveLength(1);
    expect(r.members[0]).toMatchObject({ enabled: true, preference: 100 });
  });

  it('"enabled" derives from the activation/expiration window, dates preserved', () => {
    const notYet = member({ activationDate: new Date(2_000_000).toISOString() });
    const expired = member({ expirationDate: new Date(500_000).toISOString() });
    const r = buildRoutingSnapshotResponse({ ...base, members: [notYet, expired] });
    expect(r.members.map(m => m.enabled)).toEqual([false, false]);
    expect(r.enabledMemberCount).toBe(0);
    expect(r.vendorId).toBeNull();
    expect(r.members[0]!.activationDate).toBe(notYet.activationDate);
  });

  it('two enabled members → count 2 and NO single-vendor identity', () => {
    const r = buildRoutingSnapshotResponse({
      ...base, members: [member(), member({ iVendor: 6, iRoutingGroupMember: 2 })],
    });
    expect(r.enabledMemberCount).toBe(2);
    expect(r.vendorId).toBeNull();
    expect(r.vendorName).toBeNull();
  });

  it('unverifiable binding is reported as unverified, never assumed', () => {
    const noAccount = buildRoutingSnapshotResponse({ ...base, members: [member()], accountFound: false });
    expect(noAccount.accountBindingVerified).toBe(false);
    expect(noAccount.accountRoutingGroupId).toBeNull();
    const noGroup = buildRoutingSnapshotResponse({ ...base, members: [member()], accountRoutingGroupId: null });
    expect(noGroup.accountBindingVerified).toBe(false);
  });

  it('an unknown vendor id keeps identity honest (id without a name)', () => {
    const r = buildRoutingSnapshotResponse({ ...base, members: [member({ iVendor: 99 })] });
    expect(r.members[0]).toMatchObject({ vendorId: '99', vendorName: null });
  });

  it('deterministic for identical inputs', () => {
    const a = buildRoutingSnapshotResponse({ ...base, members: [member()] });
    const b = buildRoutingSnapshotResponse({ ...base, members: [member()] });
    expect(a).toEqual(b);
  });
});
