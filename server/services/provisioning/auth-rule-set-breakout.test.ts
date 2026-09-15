import { describe, it, expect } from 'vitest';
import { planBreakoutRules, type BreakoutPrice, type BreakoutCell, type BreakoutProduct } from './auth-rule-set-breakout';
import type { Expansion } from '../rates/rate-prefix-expansion';

const PRODUCTS: BreakoutProduct[] = [
  { id: 1, code: 'FC', name: 'First Class',     trunkPrefix: '1' },
  { id: 3, code: 'BC', name: 'Business Class',  trunkPrefix: '2' },
  { id: 4, code: 'SB', name: 'Special Bravo',   trunkPrefix: '6' },
  { id: 5, code: 'SC', name: 'Special Charlie', trunkPrefix: '7' },
];
// The default package: 3 countries × 4 products, every cell mapped (1global's real state).
const CELLS: BreakoutCell[] = [];
for (const [country, base] of [['Pakistan', 40], ['India', 30], ['Bangladesh', 36]] as Array<[string, number]>) {
  PRODUCTS.forEach((p, i) => CELLS.push({ country, product: p.name, iRoutingGroup: base + i, routingGroupName: `${country} ${p.name}` }));
}
const cat = (productId: number, destinationId: number, name: string, prefixes: string[]): Expansion<BreakoutPrice> =>
  ({ row: { destinationId, prefix: null, catalogueVersionId: 1, productId }, verdict: 'catalogue', prefixes, destinationName: name, reason: null });

// 1global's First Class prices on 2026-09-15: 8 catalogue destinations → 10 prefixes, two of them Afghanistan.
const FC_1GLOBAL = [
  cat(1, 3,   'AFGHANISTAN - MOBILE AWCC', ['9370', '9371']),
  cat(1, 883, 'PAKISTAN - FIXED',          ['92']),
  cat(1, 886, 'PAKISTAN - MOBILE MOBILINK', ['9230']),
  cat(1, 887, 'PAKISTAN - MOBILE SCOM',     ['9235']),
  cat(1, 888, 'PAKISTAN - MOBILE TELENOR',  ['9234']),
  cat(1, 889, 'PAKISTAN - MOBILE UFONE',    ['9233']),
  cat(1, 890, 'PAKISTAN - MOBILE WARID',    ['9232']),
  cat(1, 891, 'PAKISTAN - MOBILE ZONG',     ['9231', '9237']),
];

describe('planBreakoutRules', () => {
  it('one rule per priced prefix, the routing group inherited from the country cell, translation strips the account prefix', () => {
    const pk = FC_1GLOBAL.filter(e => e.destinationName!.startsWith('PAKISTAN'));
    const plan = planBreakoutRules({ accountPrefix: '1019', ips: ['175.107.203.13'], products: PRODUCTS, expansions: pk, cells: CELLS });
    expect(plan.gaps).toEqual([]);
    expect(plan.rules).toHaveLength(8);
    const mobilink = plan.rules.find(r => r.prefix === '9230')!;
    expect(mobilink).toMatchObject({
      remoteIp: '175.107.203.13', country: 'Pakistan', product: 'First Class',
      incomingCld: '101919230*', cldTranslationRule: 's/^101919230/19230/',
      iRoutingGroup: 40, routingGroupName: 'Pakistan First Class', destination: 'PAKISTAN - MOBILE MOBILINK',
    });
    // The parent code is a priced prefix too (PAKISTAN - FIXED = 92) and gets its own rule; nothing broader is invented.
    expect(plan.rules.map(r => r.incomingCld)).toContain('1019192*');
    expect(plan.rules.every(r => r.incomingCld.startsWith('10191'))).toBe(true);
  });

  it('names the Afghanistan gap exactly, and refuses to invent a routing group for it', () => {
    const plan = planBreakoutRules({ accountPrefix: '1019', ips: ['175.107.203.13'], products: PRODUCTS, expansions: FC_1GLOBAL, cells: CELLS });
    expect(plan.gaps).toHaveLength(1);
    expect(plan.gaps[0]).toMatchObject({ country: 'Afghanistan', product: 'First Class' });
    expect(plan.gaps[0].reason).toBe('No routing cell covers AFGHANISTAN - MOBILE AWCC (9370, 9371) for First Class — add the row Afghanistan / First Class to the routing package and map it to a Sippy routing group.');
    // the eight Pakistan rules are still planned; the stage decides whether a gap blocks (it does)
    expect(plan.rules).toHaveLength(8);
    expect(plan.rules.some(r => r.prefix.startsWith('93'))).toBe(false);
  });

  it('a mapped Afghanistan cell turns the gap into rules', () => {
    const cells = [...CELLS, { country: 'Afghanistan', product: 'First Class', iRoutingGroup: 77, routingGroupName: 'Afghanistan First Class' }];
    const plan = planBreakoutRules({ accountPrefix: '1019', ips: ['175.107.203.13'], products: PRODUCTS, expansions: FC_1GLOBAL, cells });
    expect(plan.gaps).toEqual([]);
    expect(plan.rules).toHaveLength(10);
    expect(plan.rules.filter(r => r.iRoutingGroup === 77).map(r => r.incomingCld)).toEqual(['101919370*', '101919371*']);
  });

  it('a cell without a routing group is a gap, never a group-less rule', () => {
    const cells = CELLS.map(c => c.country === 'Pakistan' && c.product === 'First Class' ? { ...c, iRoutingGroup: null, routingGroupName: null } : c);
    const plan = planBreakoutRules({ accountPrefix: '1019', ips: ['1.1.1.1'], products: PRODUCTS, expansions: [cat(1, 886, 'PAKISTAN - MOBILE MOBILINK', ['9230'])], cells });
    expect(plan.rules).toEqual([]);
    expect(plan.gaps[0].reason).toBe('No routing group is mapped for Pakistan / First Class — PAKISTAN - MOBILE MOBILINK (9230) cannot be authenticated without one.');
  });

  it('an unpriced country gets no rule — Bangladesh and India have cells but no prices', () => {
    const plan = planBreakoutRules({ accountPrefix: '1019', ips: ['1.1.1.1'], products: PRODUCTS, expansions: [cat(1, 886, 'PAKISTAN - MOBILE MOBILINK', ['9230'])], cells: CELLS });
    expect(plan.rules.map(r => r.incomingCld)).toEqual(['101919230*']);
  });

  it('refused expansions never become rules; legacy prefix rows do; rules are per IP and de-duplicated', () => {
    const expansions: Array<Expansion<BreakoutPrice>> = [
      { row: { destinationId: 9, prefix: null, catalogueVersionId: 0, productId: 3 }, verdict: 'stale_version', prefixes: [], destinationName: 'INDIA - MOBILE', reason: 'stale' },
      { row: { destinationId: null, prefix: '9258', catalogueVersionId: null, productId: 3 }, verdict: 'legacy_prefix', prefixes: ['9258'], destinationName: null, reason: null },
      { row: { destinationId: 884, prefix: null, catalogueVersionId: 1, productId: 3 }, verdict: 'catalogue', prefixes: ['9258'], destinationName: 'PAKISTAN - FIXED KASHMIR', reason: null },
    ];
    const plan = planBreakoutRules({ accountPrefix: '1019', ips: ['1.1.1.1', '2.2.2.2', '1.1.1.1'], products: PRODUCTS, expansions, cells: CELLS });
    expect(plan.gaps).toEqual([]);
    expect(plan.ips).toEqual(['1.1.1.1', '2.2.2.2']);
    expect(plan.rules.map(r => `${r.remoteIp} ${r.incomingCld}`)).toEqual(['1.1.1.1 101929258*', '2.2.2.2 101929258*']);
    expect(plan.rules[0].cldTranslationRule).toBe('s/^101929258/29258/');
  });

  it('the longest country code wins when codes nest (1 vs 1xxx would otherwise swallow everything)', () => {
    const cells: BreakoutCell[] = [
      { country: 'USA', product: 'First Class', iRoutingGroup: 5, routingGroupName: 'US' },
      { country: 'India', product: 'First Class', iRoutingGroup: 6, routingGroupName: 'IN' },
    ];
    const plan = planBreakoutRules({ accountPrefix: '1019', ips: ['1.1.1.1'], products: PRODUCTS, expansions: [cat(1, 1, 'INDIA - MOBILE', ['9198'])], cells });
    expect(plan.rules[0].iRoutingGroup).toBe(6);
  });
});
