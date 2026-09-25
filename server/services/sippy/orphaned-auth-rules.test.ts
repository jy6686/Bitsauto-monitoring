/**
 * Deleting an auth rule stops a customer authenticating from an IP, so the cleanup tool must not
 * act on a rule the server has not itself just classified as orphaned.
 *
 * Two protections, same shape as the account path:
 *   1. classification — one definition, shared by preview and execute so they cannot drift;
 *   2. re-derivation — execute recomputes and refuses everything outside that set, including
 *      rules whose company could not be read, because "could not check" is not "safe to delete".
 */
import { describe, it, expect } from 'vitest';
import {
  orphanedAuthRules, orphanedRuleIdSet, partitionRuleDeletions, type OrphanScanInput,
} from './orphaned-auth-rules';

const SCANS: OrphanScanInput[] = [
  {
    companyId: 1, companyName: 'aura', iAccount: 1067,
    authRules: [
      { iAuthentication: 101, remoteIp: '5.5.5.5' },   // approved
      { iAuthentication: 102, remoteIp: '9.9.9.9' },   // NOT approved → orphaned
    ],
    approvedIps: ['5.5.5.5'],
  },
  {
    companyId: 2, companyName: 'asif', iAccount: 55,
    authRules: [
      { iAuthentication: 201, remoteIp: '7.0.0.8' },   // approved
      { iAuthentication: 202, remoteIp: null },        // no IP → never orphaned
      { iAuthentication: null, remoteIp: '4.4.4.4' },  // unreadable id → never deletable
    ],
    approvedIps: ['7.0.0.8'],
  },
];

describe('orphanedAuthRules', () => {
  it('reports only rules whose IP the platform has not approved', () => {
    expect(orphanedAuthRules(SCANS).map(r => r.iAuthentication)).toEqual([102]);
  });

  /** Silence is not grounds for deletion. */
  it('never treats a rule with no remote IP as orphaned', () => {
    const r = orphanedAuthRules([{ authRules: [{ iAuthentication: 1, remoteIp: null }], approvedIps: [] }]);
    expect(r).toEqual([]);
  });

  it('never surfaces a rule whose id cannot be read', () => {
    const r = orphanedAuthRules([{ authRules: [{ iAuthentication: 'abc', remoteIp: '1.2.3.4' }], approvedIps: [] }]);
    expect(r).toEqual([]);
  });

  it('carries the company identity through for the operator', () => {
    const [only] = orphanedAuthRules(SCANS);
    expect(only).toMatchObject({ companyId: 1, companyName: 'aura', iAccount: 1067, remoteIp: '9.9.9.9' });
  });

  /** An empty approved list means none are approved — it is not "unknown". */
  it('treats an empty approved list as approving nothing', () => {
    const r = orphanedAuthRules([{ authRules: [{ iAuthentication: 9, remoteIp: '1.1.1.1' }], approvedIps: [] }]);
    expect(r.map(x => x.iAuthentication)).toEqual([9]);
  });

  it('survives empty and absent input', () => {
    expect(orphanedAuthRules([])).toEqual([]);
    expect(orphanedAuthRules(null as any)).toEqual([]);
  });
});

describe('partitionRuleDeletions — execute re-derives what the browser asked for', () => {
  const orphaned = orphanedRuleIdSet(orphanedAuthRules(SCANS));

  it('deletes only a rule the server just classified as orphaned', () => {
    const { deletable, refused } = partitionRuleDeletions([102], orphaned);
    expect(deletable).toEqual([102]);
    expect(refused).toEqual([]);
  });

  /** THE PROTECTION. An approved rule must never be deleted, whatever the client sent. */
  it('refuses an approved rule and names why', () => {
    const { deletable, refused } = partitionRuleDeletions([101, 201], orphaned);
    expect(deletable).toEqual([]);
    expect(refused.map(r => r.iAuthentication)).toEqual([101, 201]);
    for (const r of refused) expect(r.reason).toMatch(/did not classify this rule as orphaned/i);
  });

  /** A company whose rules could not be listed contributes no scan, so its ids are refused. */
  it('refuses a rule whose company could not be read this pass', () => {
    const partial = orphanedRuleIdSet(orphanedAuthRules([SCANS[1]])); // aura omitted, e.g. Sippy error
    expect(partitionRuleDeletions([102], partial).deletable).toEqual([]);
  });

  it('refuses a stale client list wholesale', () => {
    const { deletable, refused } = partitionRuleDeletions([101, 201, 202, 999], orphaned);
    expect(deletable).toEqual([]);
    expect(refused).toHaveLength(4);
  });

  it('refuses unusable ids rather than passing them to the deleter', () => {
    const { deletable, refused } = partitionRuleDeletions([null, 'abc', 0, -1], orphaned);
    expect(deletable).toEqual([]);
    // The COUNT is the assertion. Iterating `refused` alone passes vacuously when a mutation
    // makes it empty — which is exactly how this test failed to catch "skip instead of refuse".
    expect(refused).toHaveLength(4);
    for (const r of refused) expect(r.reason).toMatch(/not a usable/i);
  });

  it('a repeated id is one deletion, not two', () => {
    expect(partitionRuleDeletions([102, 102, '102'], orphaned).deletable).toEqual([102]);
  });

  it('an empty or absent request deletes nothing', () => {
    expect(partitionRuleDeletions([], orphaned).deletable).toEqual([]);
    expect(partitionRuleDeletions(null, orphaned).deletable).toEqual([]);
  });

  /** An empty orphan set can only ever refuse — the fail-closed floor. */
  it('deletes nothing when the server found no orphans at all', () => {
    expect(partitionRuleDeletions([101, 102], new Set<number>()).deletable).toEqual([]);
  });
});
