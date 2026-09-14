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

/**
 * Declaring eligibility from the PRICING screen.
 *
 * The operator met the boundary as a broken-looking dropdown: Product Rates offered "Add Rate",
 * the destination list was empty, and the reason lived on another tab. One workflow now spans both
 * decisions — but they stay two decisions. Pricing must not become a way to create eligibility as
 * a side effect, because that is exactly the back door migration 514 closed.
 */
describe("inline declaration from Product Rates", () => {
  const RATES = (() => {
    const start = SRC.indexOf('function ProductRatesTab(');
    expect(start, 'ProductRatesTab must exist').toBeGreaterThan(-1);
    const next = SRC.indexOf('\n// ──', start);
    return code(SRC.slice(start, next < 0 ? undefined : next));
  })();

  it("declares through the SAME eligibility API, not a private path", () => {
    // The declaration is one endpoint. A second way to write eligibility would be a second
    // source of truth for what a product sells.
    expect(RATES).toContain('apiRequest("POST", `/api/products/${selectedProductId}/eligibility`, { destinationId })');
  });

  it("does NOT write eligibility directly into the rate call", () => {
    // The failure this guards: a rate POST that also grants eligibility would let pricing sell
    // something nobody declared — the back door, rebuilt in the UI.
    // Bounded at the call's OWN closing brace, not a character count: a fixed window spills into
    // whatever follows and then asserts against the neighbours' code.
    const at = RATES.indexOf('createMut.mutate({');
    expect(at, 'the rate creation call must exist').toBeGreaterThan(-1);
    const end = RATES.indexOf('\n    });', at);
    expect(end, 'the call must be closed').toBeGreaterThan(at);
    const createCall = RATES.slice(at, end);
    // It may READ the eligibility response — `catalogueVersionId` comes from it, which is how a
    // rate declares its id space (migration 515). What it must not do is GRANT.
    expect(createCall).toContain('catalogueVersionId: eligibility.catalogue.versionId');
    expect(createCall).not.toContain('/eligibility');
    expect(createCall).not.toContain('declareMut');
    expect(createCall).not.toMatch(/destinationEligib|grantEligib/i);
  });

  it("searches the ACTIVE catalogue version the eligibility layer reports", () => {
    // Not a version the screen picked. Declaring against a version the eligibility reader is not
    // scoped to would produce rows that exist and never resolve.
    expect(RATES).toContain('const activeVersionId = eligibility?.catalogue?.versionId ?? null');
    expect(RATES).toContain('`/api/commercial/catalogues/${activeVersionId}/destinations');
  });

  it("refuses to invent a destination — only catalogue rows can be declared", () => {
    expect(RATES).toContain('declare-no-matches');
    expect(RATES).toMatch(/cannot be declared here/);
  });

  it("an already-declared destination offers no second declaration", () => {
    // UNIQUE (product_id, destination_id) means re-granting is a no-op; saying so beats a button
    // that appears to do something.
    expect(RATES).toContain('Already declared');
  });

  it("tells the operator that declaring sets no price and pushes nothing", () => {
    expect(RATES).toMatch(/does not set a price and/);
    expect(RATES).toMatch(/sends nothing to the switch/);
  });

  it("both entry points exist: the empty state and the dropdown", () => {
    // The empty state is where a new product lands; the dropdown is where an existing one runs
    // out of declared destinations. Missing either leaves the gate looking like a fault.
    expect(RATES).toContain('button-declare-from-empty');
    expect(RATES).toContain('button-declare-inline');
  });

  it("re-reads eligibility after declaring, so the new row is priceable immediately", () => {
    expect(RATES).toContain('qc.invalidateQueries({ queryKey: ["/api/products", selectedProductId, "eligibility"] })');
  });
});

describe("the declaration says who made it", () => {
  const STORE = readFileSync(join(__dirname, 'eligibility-store.ts'), 'utf8');

  it("the list carries declaredBy and declaredAt", () => {
    // Eligibility is a commercial claim. A reader who cannot see whose claim it is has to open
    // the database to find out, which in practice means nobody checks.
    expect(STORE).toContain('declaredBy: string | null');
    expect(STORE).toContain('declaredAt: string | null');
    expect(STORE).toContain('e.created_by, e.created_at');
  });

  it("an unresolvable actor id is reported as unknown, never as a name", () => {
    const ROUTES = readFileSync(join(__dirname, '..', '..', 'routes-product-eligibility.ts'), 'utf8');
    expect(ROUTES).toContain('declaredByName');
    expect(ROUTES).toContain('names.get(d.declaredBy) ?? null');
  });

  it("a failed name lookup does not fail the eligibility read", () => {
    const ROUTES = code(readFileSync(join(__dirname, '..', '..', 'routes-product-eligibility.ts'), 'utf8'));
    // The commercial fact is the answer; the display name is a convenience on top of it.
    expect(ROUTES).toMatch(/catch\s*\{/);
  });
});
