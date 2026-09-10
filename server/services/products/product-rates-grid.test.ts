/**
 * The Product Rates screen's contract, asserted against the client source.
 *
 * It lives under server/ because vitest.config.ts collects `server/**\/*.test.ts` only, and reads
 * the client file off disk the same way eligibility-routes.test.ts reads its route module.
 *
 * What is guarded here is a set of things that were WRONG in production and would be silent if they
 * came back: reading the retired legacy join, keying rows on a single prefix when a destination has
 * many, and rendering an undeclared product identically to a broken catalogue.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FILE = join(__dirname, '..', '..', '..', 'client', 'src', 'pages', 'rate-manager.tsx');
const SRC  = readFileSync(FILE, 'utf8');

/** Just the Product Rates component, bounded at the next top-level declaration. */
const TAB = (() => {
  const start = SRC.indexOf('function ProductRatesTab(');
  expect(start, 'ProductRatesTab must exist').toBeGreaterThan(-1);
  const next = SRC.indexOf('\n// ──', start);
  return SRC.slice(start, next < 0 ? undefined : next);
})();

/** Code only — comments stripped, so an explanation cannot satisfy an assertion about behaviour. */
const code = (t: string) =>
  t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join('\n');

const CODE = code(TAB);

describe("it reads the eligibility API and nothing legacy", () => {
  it("queries the product's declared eligibility", () => {
    expect(CODE).toContain('/api/products/${selectedProductId}/eligibility');
  });

  it("NEVER reads the retired join", () => {
    // /api/commercial-destinations joins product_destination_assignments to global_destinations.
    // Migration 514 marked both non-authoritative; the 52 legacy rows stay where they are and
    // nothing on this screen consumes them.
    for (const legacy of ['/api/commercial-destinations', 'product_destination_assignments', 'global_destinations', 'CommercialDest']) {
      expect(CODE, `must not reference ${legacy}`).not.toContain(legacy);
    }
  });

  it("does not fall back to showing every destination when eligibility is empty", () => {
    // An empty list is the truthful answer, not a prompt to substitute a wider one.
    expect(CODE).not.toMatch(/catalogue\?\.destinations|allDestinations|\|\|\s*catalogue/);
  });
});

describe("a row is a destination, not a prefix", () => {
  it("keys rates to destinations by destinationId", () => {
    expect(CODE).toMatch(/destinationId\s*\?\?\s*r\.destination_id|r\.destinationId/);
    expect(CODE).toContain('byDest');
  });

  it("no longer keys the grid on a single prefix", () => {
    // The old grid did byPrefix.get(d.prefix), which cannot work once a destination holds many.
    expect(CODE).not.toContain('byPrefix');
    expect(CODE).not.toContain('assignedPrefixes');
  });

  it("corroborates a matched id against the destination's own prefixes", () => {
    // product_rates.destination_id predates the catalogue and may hold an id from another id
    // space. A numeric collision must not be rendered as this destination's price.
    expect(CODE).toContain('corroborated');
    expect(CODE).toContain('d.prefixes.includes(String(cand.prefix))');
  });

  it("an uncorroborated rate is still shown, in the not-eligible group", () => {
    // Hiding it would make the grid disagree with what provisioning uploads.
    expect(CODE).toContain('claimed.has(r)');
    expect(CODE).toContain('unassigned: true');
    expect(TAB).toContain('not eligible for this product');
  });

  it("renders every prefix a destination covers, not a representative one", () => {
    expect(CODE).toContain('+{prefixes.length - 1} more');
    expect(CODE).toContain('title={prefixes.join(", ")}');
  });
});

describe("an empty result is not a broken catalogue", () => {
  const states = [
    ['empty-catalogue-unreadable', 'the read failed'],
    ['empty-no-active-version',    'no version is active'],
    ['empty-catalogue-empty',      'the catalogue holds nothing'],
    ['empty-none-declared',        'the product has no declared eligibility'],
  ] as const;

  it("distinguishes all four situations, each with its own panel", () => {
    for (const [id, why] of states) {
      expect(CODE, `${id} — ${why}`).toContain(`data-testid="${id}"`);
    }
  });

  it("branches on the catalogue signal the API returns, not on list length alone", () => {
    expect(CODE).toContain('eligibility.catalogue.destinationCount === 0');
    expect(CODE).toContain('!eligibility.catalogue');
    expect(CODE).toContain('eligError');
  });

  it("says out loud that no declared eligibility is not 'every destination'", () => {
    expect(TAB).toContain('It does not mean every');
  });

  it("blames the catalogue only when the catalogue is actually at fault", () => {
    // The old single message sent an operator to the Destination Catalogue in every case,
    // including the one where the catalogue was healthy and nobody had made a commercial decision.
    expect(CODE).not.toContain('assign them in the Destination Catalogue first');
  });
});

describe("it refuses to price a destination it cannot price correctly", () => {
  it("blocks saving a multi-prefix destination", () => {
    // rate-upload.service.ts and rates.step.ts both select a single `prefix`. Writing one of a
    // destination's prefixes would upload a price for that one and silently leave the rest
    // unpriced — wrong quietly, which is worse than unavailable loudly.
    expect(CODE).toContain('const multiPrefix =');
    expect(CODE).toContain('chosenDest.prefixes.length > 1');
    expect(CODE).toContain('disabled={createMut.isPending || multiPrefix}');
  });

  it("says why, on the form, rather than failing silently", () => {
    expect(CODE).toContain('data-testid="warn-multi-prefix"');
  });

  it("carries a prefix only when the destination has exactly one", () => {
    expect(CODE).toMatch(/prefixes\.length === 1 \? d\.prefixes\[0\] : ""/);
  });

  it("sends destinationId as the key on create", () => {
    expect(CODE).toContain('destinationId: Number(form.destinationId)');
  });
});
