#!/usr/bin/env node
/**
 * verify-rate-analysis.mjs — assert the reverse prefix resolver behaves.
 *
 *   DATABASE_URL='…' npx tsx scripts/verify-rate-analysis.mjs
 *
 * Exits 0 when every case passes, 1 when any fails.
 *
 * Cases are expressed as expectations about MEANING, not about the shape of a response, so
 * this fails when the resolver becomes wrong rather than when it becomes different. Each is a
 * question Rate Analysis will actually ask of live Sippy data.
 *
 * Requires the catalogue to be present and active — run verify-catalogue.mjs first; a resolver
 * returning "unknown" for everything against an empty database is not a resolver failure.
 */
import { resolvePrefix } from '../server/services/commercial/prefix-resolver.ts';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Refusing to guess a database.');
  process.exit(2);
}

const CASES = [
  // query        expected match   expected destination            why this case exists
  ['9231',        'exact',         'PAKISTAN - MOBILE ZONG',       'a catalogue prefix, as stored'],
  ['19231',       'exact',         'PAKISTAN - MOBILE ZONG',       'same prefix carrying First Class trunk digit'],
  ['29231',       'exact',         'PAKISTAN - MOBILE ZONG',       'same destination, Business Class trunk'],
  ['9237',        'exact',         'PAKISTAN - MOBILE ZONG',       'Zong owns two prefixes; both must reach it'],
  ['923',         'exact',         'PAKISTAN - MOBILE',            'country-level prefix is a real destination, not a fallback'],
  ['9231234567',  'longest_match', 'PAKISTAN - MOBILE ZONG',       'a dialled number resolves to the longest prefix, not the shortest'],
  ['92300',       'longest_match', 'PAKISTAN - MOBILE MOBILINK',   'THE defect prefix: finer than the catalogue sells, inside Mobilink'],
  ['9233',        'exact',         'PAKISTAN - MOBILE UFONE',      'operator-level'],
  ['91',          'exact',         'INDIA - FIXED',                'a country with no operator tier still resolves'],
  ['1',           'unknown',       null,                           'a bare trunk digit is not a destination'],
];

const results = [];
for (const [query, wantMatch, wantDest, why] of CASES) {
  let r, err = null;
  try { r = await resolvePrefix(query); } catch (e) { err = e.message; }
  const ok = !err && r.match === wantMatch && (wantDest === null || r.destination === wantDest);
  results.push({ query, ok, why,
    got: err ? `ERROR ${err}` : `${r.match} → ${r.destination ?? '—'}${r.trunkStripped ? ` (trunk ${r.trunkDigit})` : ''}`,
    want: `${wantMatch} → ${wantDest ?? '—'}` });
}

// A destination reached by two different trunk digits must be the SAME destination. The trunk
// is the product, not part of the identity, and this is the property that stops a Business
// Class lookup silently landing somewhere else.
const fc = await resolvePrefix('19231'), bc = await resolvePrefix('29231');
results.push({
  query: 'trunk-independence', why: 'product must not change which destination a prefix means',
  ok: fc.destinationId !== null && fc.destinationId === bc.destinationId,
  got: `FC→${fc.destinationId} BC→${bc.destinationId}`, want: 'same destination id',
});

for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${String(r.query).padEnd(18)} ${r.got.padEnd(46)} ${r.ok ? '' : `want: ${r.want}`}`);
  if (!r.ok) console.log(`      ${r.why}`);
}
const bad = results.filter(r => !r.ok);
console.log(bad.length ? `\n✗ ${bad.length} of ${results.length} failed.\n` : `\n✓ all ${results.length} checks passed.\n`);
process.exit(bad.length ? 1 : 0);
