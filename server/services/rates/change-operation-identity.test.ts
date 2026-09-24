/**
 * Deriving a rate change's identity from the only thing Rate Analysis sends: a full prefix.
 *
 * The rule under test is not "split the string" — it is "split it only when the split is
 * certain". `dial_prefix` is what `deriveNotificationsFromPush` uses to decide whether an
 * operation may be announced to a customer, so a confident-but-wrong split here is a wrong
 * price in someone's inbox. Every ambiguous case below must therefore yield null, and the
 * assertions say so for all three fields together: a partial claim would be the same bug.
 */
import { describe, it, expect } from 'vitest';
import { deriveOperationIdentity } from './change-operation-identity';

const FIRST_CLASS = { trunkPrefix: '1', productName: 'FC' };
const BUSINESS    = { trunkPrefix: '2', productName: 'BC' };
const CATALOGUE   = [FIRST_CLASS, BUSINESS];

const NOTHING = { trunkPrefix: null, dialPrefix: null, productName: null };

describe('a full prefix yields trunk, dial and product together', () => {
  it('splits the worked example: 19230 → trunk 1, dial 9230, First Class', () => {
    expect(deriveOperationIdentity('19230', CATALOGUE)).toEqual({
      trunkPrefix: '1', dialPrefix: '9230', productName: 'FC',
    });
  });

  it('routes by the trunk digit, not by position in the catalogue', () => {
    expect(deriveOperationIdentity('29230', CATALOGUE)).toEqual({
      trunkPrefix: '2', dialPrefix: '9230', productName: 'BC',
    });
  });

  it('prefers the longest matching trunk, so a 2-digit trunk is not shadowed by a 1-digit one', () => {
    const withLong = [...CATALOGUE, { trunkPrefix: '19', productName: 'SPECIAL' }];
    expect(deriveOperationIdentity('19230', withLong)).toEqual({
      trunkPrefix: '19', dialPrefix: '230', productName: 'SPECIAL',
    });
  });
});

describe('it refuses rather than guesses', () => {
  it('yields nothing when no trunk matches', () => {
    expect(deriveOperationIdentity('79230', CATALOGUE)).toEqual(NOTHING);
  });

  it('yields nothing when two products claim the same trunk', () => {
    const ambiguous = [FIRST_CLASS, { trunkPrefix: '1', productName: 'OTHER' }];
    expect(deriveOperationIdentity('19230', ambiguous)).toEqual(NOTHING);
  });

  it('yields nothing when the trunk consumes the whole prefix — no destination was identified', () => {
    expect(deriveOperationIdentity('1', CATALOGUE)).toEqual(NOTHING);
  });

  it('ignores products carrying no usable trunk, the way push-batch refuses them', () => {
    const unusable = [{ trunkPrefix: null, productName: 'NOTRUNK' }, { trunkPrefix: '   ', productName: 'BLANK' }];
    expect(deriveOperationIdentity('19230', unusable)).toEqual(NOTHING);
  });

  it('ignores a trunk whose product has no name — a trunk alone identifies nothing', () => {
    expect(deriveOperationIdentity('19230', [{ trunkPrefix: '1', productName: null }])).toEqual(NOTHING);
  });

  it('yields nothing for an empty or absent prefix', () => {
    for (const p of ['', '   ', null, undefined]) {
      expect(deriveOperationIdentity(p as any, CATALOGUE)).toEqual(NOTHING);
    }
  });

  it('yields nothing when the catalogue is empty, rather than inventing a one-digit trunk', () => {
    expect(deriveOperationIdentity('19230', [])).toEqual(NOTHING);
  });

  it('two products agreeing on trunk AND name is not ambiguous — duplicates are not a conflict', () => {
    const duplicated = [FIRST_CLASS, { trunkPrefix: '1', productName: 'FC' }];
    expect(deriveOperationIdentity('19230', duplicated)).toEqual({
      trunkPrefix: '1', dialPrefix: '9230', productName: 'FC',
    });
  });
});
