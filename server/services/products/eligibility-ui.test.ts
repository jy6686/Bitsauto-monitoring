/**
 * The Eligibility screen's contract, asserted against the client source.
 *
 * This screen closed a dead end: the eligibility API and the Product Rates grid that consumes it
 * both existed, but nothing could CREATE eligibility. Every product declared nothing, so Product
 * Rates showed nothing, so nothing could be priced or pushed. What is guarded here is that the
 * screen declares eligibility and does ONLY that.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, '..', '..', '..', 'client', 'src', 'pages', 'rate-manager.tsx'), 'utf8');

const TAB = (() => {
  const start = SRC.indexOf('function EligibilityTab(');
  expect(start, 'EligibilityTab must exist').toBeGreaterThan(-1);
  const next = SRC.indexOf('\n// ──', start);
  return SRC.slice(start, next < 0 ? undefined : next);
})();
const code = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join('\n');
const CODE = code(TAB);

describe("the screen is reachable", () => {
  it("is registered as a tab and rendered", () => {
    expect(SRC).toContain('{ key: "eligibility"   as const, label: "Eligibility"     },');
    expect(SRC).toContain('{activeTab === "eligibility"   && <EligibilityTab products={products} />}');
  });

  it("the tab state type admits it, so a deep link resolves rather than falling back", () => {
    expect(SRC).toMatch(/useState<[^>]*"eligibility"[^>]*>\(/);
  });
});

describe("it declares eligibility, against the versioned catalogue", () => {
  it("grants through the eligibility API", () => {
    expect(CODE).toContain('`/api/products/${selectedProductId}/eligibility`');
    expect(CODE).toContain('apiRequest("POST"');
    expect(CODE).toContain('{ destinationId }');
  });

  it("withdraws rather than deleting", () => {
    // Withdrawal is a POST to /withdraw; nothing here issues a DELETE, because "no longer sold
    // here" is a claim someone made and the row keeps who made it.
    expect(CODE).toContain('/eligibility/${destinationId}/withdraw');
    expect(CODE).not.toContain('apiRequest("DELETE"');
  });

  it("lists destinations from the ACTIVE catalogue version the API reports", () => {
    // Not a hardcoded version, and not the legacy tree.
    expect(CODE).toContain('eligibility?.catalogue?.versionId');
    expect(CODE).toContain('`/api/commercial/catalogues/${versionId}/destinations');
  });

  it("refuses to act when no catalogue version is active", () => {
    expect(CODE).toContain('data-testid="eligibility-no-catalogue"');
  });
});

describe("what it must NOT do", () => {
  it("never reads the retired tables or the legacy endpoint", () => {
    for (const legacy of ['/api/commercial-destinations', 'product_destination_assignments', 'global_destinations']) {
      expect(CODE, `must not reference ${legacy}`).not.toContain(legacy);
    }
  });

  it("does not price and does not push", () => {
    // Declaring what a product sells is a different act from pricing it, and a different act
    // again from sending it to a switch. This screen does only the first.
    for (const forbidden of ['/api/product-rates', 'push-batch', 'push-to-sippy', 'rate:', 'effectiveFrom']) {
      expect(CODE, `must not do ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("offers no way to declare everything at once", () => {
    // A "grant all" is how a commercial decision gets manufactured by a convenience button.
    for (const bulk of ['grantAll', 'declareAll', 'forEach(d =>', '.map(d => grant']) {
      expect(CODE, `must not offer ${bulk}`).not.toContain(bulk);
    }
  });
});

describe("it can actually be used against 1,344 destinations", () => {
  it("searches and pages rather than rendering the whole catalogue", () => {
    expect(CODE).toContain('data-testid="eligibility-search"');
    expect(CODE).toContain('offset=${page * PAGE}');
  });

  it("the declared-only view reads from the eligibility response, not the current page", () => {
    // Filtering the catalogue page would show only what that page happens to hold, which is a
    // different question from what the product actually sells.
    expect(CODE).toContain('onlyEligible');
    expect(CODE).toMatch(/onlyEligible\s*\n?\s*\?\s*\(eligibility\?\.destinations/);
  });

  it("shows how many are declared against the catalogue size", () => {
    expect(CODE).toContain('eligibility.catalogue.destinationCount.toLocaleString()');
  });
});
