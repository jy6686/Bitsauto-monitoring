import { describe, it, expect } from 'vitest';
import {
  selectCredentials, pagesForRun, credKeyFor, DEFAULT_RETIRE_AFTER,
  type CredPair,
} from './credential-memory';

// The production shape: sippyXmlCredsPairs filters to admin-username pairs, so
// every rung carries the same username and differs only by password.
const LADDER: CredPair[] = [
  { username: 'ssp-root', password: 'a' },
  { username: 'ssp-root', password: 'b' },
  { username: 'ssp-root', password: 'c' },
  { username: 'ssp-root', password: 'd' },
];
const K = (i: number) => credKeyFor(i, 'ssp-root');
const mem = (proven: string[] = [], failures: Array<[string, number]> = []) =>
  ({ proven: new Set(proven), failures: new Map(failures) });

describe('a fresh run offers the whole ladder, in its declared order', () => {
  it('changes nothing before anything is known', () => {
    const got = selectCredentials(LADDER, mem());
    expect(got).toHaveLength(4);
    expect(got.map(c => c.password)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('labels rungs so four pairs sharing a username stay distinguishable', () => {
    // The tally used to key by username, collapsing all four into one row —
    // which is why production could not show WHICH pair authenticates.
    expect(selectCredentials(LADDER, mem()).map(c => c.label))
      .toEqual(['ssp-root#1', 'ssp-root#2', 'ssp-root#3', 'ssp-root#4']);
  });

  it('never puts password material in a key or a label', () => {
    for (const c of selectCredentials(LADDER, mem())) {
      expect(c.key).not.toContain(c.password);
      expect(c.label).not.toContain(c.password);
    }
  });
});

describe('retiring a pair that keeps failing', () => {
  it('keeps asking after one failure — a blip must not retire a credential', () => {
    const got = selectCredentials(LADDER, mem([], [[K(0), 1]]));
    expect(got.map(c => c.key)).toContain(K(0));
  });

  it('stops asking at the threshold', () => {
    const got = selectCredentials(LADDER, mem([], [[K(0), DEFAULT_RETIRE_AFTER]]));
    expect(got.map(c => c.key)).not.toContain(K(0));
    expect(got).toHaveLength(3);
  });

  it('drops the three wrong passwords and keeps the working one', () => {
    const got = selectCredentials(LADDER, mem([K(3)], [[K(0), 2], [K(1), 2], [K(2), 2]]));
    expect(got.map(c => c.password)).toEqual(['d']);
  });
});

describe('the two recovery paths', () => {
  it('never retires a pair that has ever succeeded', () => {
    // A proven credential that later errors is a switch problem, not a wrong
    // password. Retiring it would convert an outage into an empty window.
    const got = selectCredentials(LADDER, mem([K(1)], [[K(1), 99]]));
    expect(got.map(c => c.key)).toContain(K(1));
  });

  it('restores the whole ladder when retiring would leave nothing', () => {
    const all: Array<[string, number]> = [[K(0), 5], [K(1), 5], [K(2), 5], [K(3), 5]];
    const got = selectCredentials(LADDER, mem([], all));
    expect(got).toHaveLength(4);
    expect(got.map(c => c.password)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('an authentication outage stays a FAILED fetch, never an empty window', () => {
    // Expressed as the property that matters: there is always something to
    // try, so the loop can always produce a real error rather than silence.
    for (const f of [0, 1, 2, 5, 50]) {
      const failures = LADDER.map((_, i): [string, number] => [K(i), f]);
      expect(selectCredentials(LADDER, mem([], failures)).length).toBeGreaterThan(0);
    }
  });
});

describe('ordering', () => {
  it('tries the proven pair first, so a slice with rows ends after one page', () => {
    const got = selectCredentials(LADDER, mem([K(2)]));
    expect(got[0].password).toBe('c');
  });

  it('keeps ladder priority among equals', () => {
    // sippyXmlCredsPairs orders deliberately: explicit admin creds, then
    // recovery combinations, then the platform default.
    expect(selectCredentials(LADDER, mem()).map(c => c.password)).toEqual(['a', 'b', 'c', 'd']);
    expect(selectCredentials(LADDER, mem([K(1), K(3)])).map(c => c.password))
      .toEqual(['b', 'd', 'a', 'c']);
  });

  it('offers every unretired pair, because the silent-auth guard still runs', () => {
    // The guard asks the remaining credentials even after one answers cleanly
    // empty. Selection must not pre-empt that by returning only the winner.
    expect(selectCredentials(LADDER, mem([K(0)]))).toHaveLength(4);
  });
});

describe('the saving, as arithmetic against the production numbers', () => {
  it('takes an empty account from 192 pages to 54', () => {
    // asif #55 last night: 48 slices, 4 rungs, only the last authenticates.
    const before = 48 * 4;
    const after  = pagesForRun({ slices: 48, rungs: 4, workingRung: 3 });
    expect(before).toBe(192);
    expect(after).toBe(54);
    expect(1 - after / before).toBeGreaterThan(0.7);
  });

  it('spends the extra pages only on the first two slices', () => {
    // 2 slices × 4 rungs, then 46 × 1 = 54. The cost of learning is bounded
    // and paid once, not 48 times.
    expect(pagesForRun({ slices: 2,  rungs: 4, workingRung: 3 })).toBe(8);
    expect(pagesForRun({ slices: 48, rungs: 4, workingRung: 3 })
         - pagesForRun({ slices: 47, rungs: 4, workingRung: 3 })).toBe(1);
  });

  it('on an EMPTY account the winning rung’s position changes nothing', () => {
    // Because the silent-auth guard asks every live credential even after one
    // answers cleanly empty. Only retirement saves pages here — ordering does
    // not. My first draft of this test assumed otherwise and was wrong.
    for (const workingRung of [0, 1, 2, 3]) {
      expect(pagesForRun({ slices: 48, rungs: 4, workingRung })).toBe(54);
    }
  });

  it('on an account WITH rows the loop returns early, so ordering is the saving', () => {
    // asterisk #315 last night: 111 pages across 48 slices. Once the working
    // rung is proven it is tried first and the fetch returns on page one.
    const after = pagesForRun({ slices: 48, rungs: 4, workingRung: 3, hasRows: true });
    expect(after).toBe(51);
    expect(after).toBeLessThan(111);
  });

  it('costs one page a slice when the first rung works and rows come back', () => {
    expect(pagesForRun({ slices: 48, rungs: 4, workingRung: 0, hasRows: true })).toBe(48);
  });

  it('scales the saving with the number of wrong rungs', () => {
    const two   = pagesForRun({ slices: 48, rungs: 2, workingRung: 1 });
    const four  = pagesForRun({ slices: 48, rungs: 4, workingRung: 3 });
    const eight = pagesForRun({ slices: 48, rungs: 8, workingRung: 7 });
    expect(two).toBeLessThan(four);
    expect(four).toBeLessThan(eight);
    // Even at eight rungs the steady state is one page per slice.
    expect(eight - 46).toBe(8 * 2);
  });
});
