/**
 * The cleanup tool must never offer a live customer's Sippy account for deletion.
 *
 * Two independent protections are pinned here, because either alone is insufficient:
 *   1. classification — a linked account is tracked whatever its provisioning workflow says;
 *   2. re-derivation — the destructive endpoint refuses ids the server itself cannot classify
 *      as untracked, so a stale browser cannot delete an account the preview never offered.
 *
 * The production scenario of 2026-09-25 is reproduced verbatim as its own test.
 */
import { describe, it, expect } from 'vitest';
import {
  toAccountId, linkedAccountIds, isUntracked, partitionDeletions, type CompanyIdentity,
} from './tracked-accounts';

/** The real list, from the Sippy ↔ Platform Sync modal on 2026-09-25. */
const PRODUCTION_COMPANIES: CompanyIdentity[] = [
  { id: 1, name: 'aura',        sippyIAccount: 1067, provisioningStatus: 'draft' },
  { id: 2, name: '1gloabl',     sippyIAccount: 1069, provisioningStatus: 'draft' },
  { id: 3, name: 'shareef-tel', sippyIAccount: 1068, provisioningStatus: 'pending_provision' },
  { id: 4, name: 'test-31',     sippyIAccount: 1065, provisioningStatus: 'provisioned' },
  { id: 5, name: 'asif',        sippyIAccount: 55,   provisioningStatus: 'provisioned' },
  { id: 6, name: 'noman',       sippyIAccount: 96,   provisioningStatus: 'imported' },
  { id: 7, name: 'unlinked-co', sippyIAccount: null, provisioningStatus: 'draft' },
];

describe('toAccountId', () => {
  it('accepts a positive integer in either number or string form', () => {
    expect(toAccountId(1067)).toBe(1067);
    expect(toAccountId('1067')).toBe(1067);
  });

  /** An id we cannot read is never evidence that an account is safe to delete. */
  it('rejects anything that is not a usable id', () => {
    for (const bad of [null, undefined, '', 'abc', 0, -1, 1.5, NaN, {}, []]) {
      expect(toAccountId(bad)).toBeNull();
    }
  });
});

describe('linkedAccountIds', () => {
  /** THE FIX. The old predicate also required provisioningStatus === 'provisioned'. */
  it('counts every linked account regardless of provisioning status', () => {
    const linked = linkedAccountIds(PRODUCTION_COMPANIES);
    expect([...linked].sort((a, b) => a - b)).toEqual([55, 96, 1065, 1067, 1068, 1069]);
  });

  it('ignores companies with no account id', () => {
    expect(linkedAccountIds([{ sippyIAccount: null }, { sippyIAccount: '' }]).size).toBe(0);
  });

  it('never consults provisioningStatus', () => {
    const a = linkedAccountIds([{ sippyIAccount: 7, provisioningStatus: 'provisioned' }]);
    const b = linkedAccountIds([{ sippyIAccount: 7, provisioningStatus: 'draft' }]);
    expect([...a]).toEqual([...b]);
  });

  it('survives a null list', () => {
    expect(linkedAccountIds(null as any).size).toBe(0);
  });
});

describe('isUntracked', () => {
  const linked = linkedAccountIds(PRODUCTION_COMPANIES);

  /** THE INCIDENT THIS PREVENTS. These four were listed as deletable in production. */
  it('does NOT classify aura, 1gloabl, shareef-tel or test-31 as untracked', () => {
    for (const live of [1067, 1069, 1068, 1065]) {
      expect(isUntracked(live, linked)).toBe(false);
    }
  });

  it('still classifies a genuinely unknown Sippy account as untracked', () => {
    expect(isUntracked(9999, linked)).toBe(true);
  });

  /** Fails closed: an unreadable id is not "safe to delete". */
  it('refuses to call an unreadable id untracked', () => {
    for (const bad of [null, undefined, 'abc', 0, -3]) {
      expect(isUntracked(bad, linked)).toBe(false);
    }
  });
});

describe('partitionDeletions — the server re-derives what the browser asked for', () => {
  const linked = linkedAccountIds(PRODUCTION_COMPANIES);

  it('refuses every linked account and names why', () => {
    const { deletable, refused } = partitionDeletions([1067, 1069, 9999], linked);
    expect(deletable).toEqual([9999]);
    expect(refused.map(r => r.iAccount)).toEqual([1067, 1069]);
    for (const r of refused) expect(r.reason).toMatch(/linked to a platform company/i);
  });

  /** A stale tab submitting the whole old orphan list must delete nothing that is now linked. */
  it('lets nothing through when every requested id is linked', () => {
    const { deletable, refused } = partitionDeletions([1067, 1069, 1068, 1065, 55, 96], linked);
    expect(deletable).toEqual([]);
    expect(refused).toHaveLength(6);
  });

  it('refuses unusable ids rather than passing them to the deleter', () => {
    const { deletable, refused } = partitionDeletions([null, 'abc', -1, 0], linked);
    expect(deletable).toEqual([]);
    expect(refused).toHaveLength(4);
    for (const r of refused) expect(r.reason).toMatch(/not a usable/i);
  });

  it('a repeated id is one deletion, not two', () => {
    expect(partitionDeletions([9999, 9999, '9999'], linked).deletable).toEqual([9999]);
  });

  it('an empty or absent request deletes nothing', () => {
    expect(partitionDeletions([], linked).deletable).toEqual([]);
    expect(partitionDeletions(null, linked).deletable).toEqual([]);
    expect(partitionDeletions(undefined, linked).deletable).toEqual([]);
  });

  /** If the platform knows nothing, everything is untracked — the caller must still have
   *  fetched companies successfully; a failed fetch throws before reaching here. */
  it('treats an empty linked set as "nothing is known"', () => {
    expect(partitionDeletions([1067], new Set<number>()).deletable).toEqual([1067]);
  });
});
