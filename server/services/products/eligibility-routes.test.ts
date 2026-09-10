/**
 * The eligibility API's contract, asserted against the route source.
 *
 * The behaviour underneath is covered by eligibility-store.test.ts against real Postgres. What is
 * checked here is what the ENDPOINTS promise, and in particular the things they must never do:
 * infer eligibility, read a retired table, or let an empty result be mistaken for "everything".
 *
 * Every claim is anchored to text that would have to be deliberately removed to break it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, '..', '..', 'routes-product-eligibility.ts'), 'utf8');
const ROUTES = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8');

/** One handler's own text, bounded at the next route registration. */
const handler = (verb: string, path: string) => {
  const start = SRC.indexOf(`app.${verb}('${path}'`);
  if (start < 0) return '';
  const next = SRC.indexOf('\n  app.', start + 10);
  return SRC.slice(start, next < 0 ? undefined : next);
};
/** Code only — comments stripped, so an explanation cannot satisfy an assertion about behaviour. */
const code = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe("the module is registered and separate from the catalogue", () => {
  it("is wired into the app", () => {
    expect(ROUTES).toContain("import { registerProductEligibilityRoutes } from './routes-product-eligibility'");
    expect(ROUTES).toContain('registerProductEligibilityRoutes(app);');
  });

  it("lives OUTSIDE routes-commercial-catalogue, whose own rule is that no endpoint takes a product", () => {
    const catalogue = readFileSync(join(__dirname, '..', '..', 'routes-commercial-catalogue.ts'), 'utf8');
    expect(catalogue).toContain('No endpoint takes a product');
    expect(catalogue).not.toContain('eligibility');
  });
});

describe("the four endpoints", () => {
  const expected: Array<[string, string]> = [
    ['get',  '/api/products/:productId/eligibility'],
    ['post', '/api/products/:productId/eligibility'],
    ['post', '/api/products/:productId/eligibility/:destinationId/withdraw'],
    ['get',  '/api/products/eligibility/rollover'],
  ];

  it("all exist", () => {
    for (const [verb, path] of expected) {
      expect(handler(verb, path).length, `${verb.toUpperCase()} ${path}`).toBeGreaterThan(100);
    }
  });

  it("every one is role-gated", () => {
    for (const [verb, path] of expected) {
      expect(code(handler(verb, path)), `${verb} ${path}`).toMatch(/requireRole\((READ|WRITE)/);
    }
  });

  it("the reads use READ and the writes use WRITE", () => {
    expect(code(handler('get',  '/api/products/:productId/eligibility'))).toContain('requireRole(READ');
    expect(code(handler('get',  '/api/products/eligibility/rollover'))).toContain('requireRole(READ');
    expect(code(handler('post', '/api/products/:productId/eligibility'))).toContain('requireRole(WRITE');
    expect(code(handler('post', '/api/products/:productId/eligibility/:destinationId/withdraw'))).toContain('requireRole(WRITE');
  });

  it("both reads perform no write", () => {
    for (const [verb, path] of [['get', '/api/products/:productId/eligibility'], ['get', '/api/products/eligibility/rollover']] as const) {
      const h = code(handler(verb, path));
      for (const w of ['grantEligibility', 'withdrawEligibility', 'INSERT', 'UPDATE', 'DELETE', 'writeAudit']) {
        expect(h, `${verb} ${path} must not ${w}`).not.toContain(w);
      }
    }
  });
});

describe("what these endpoints refuse to do", () => {
  it("NEVER reads the retired tables", () => {
    // 514 marks product_destination_assignments non-authoritative; global_destinations and the id
    // map belong to the id space this layer exists to leave behind.
    for (const legacy of ['product_destination_assignments', 'global_destinations', 'destination_id_map', 'commercial-destinations']) {
      expect(code(SRC), `must not reference ${legacy}`).not.toContain(legacy);
    }
  });

  it("offers no way to grant everything at once", () => {
    // A "grant all" is how a commercial decision gets manufactured by a convenience feature.
    for (const bulk of ['grantAll', 'bulk', 'SELECT id FROM commercial_destinations', 'forEach(d =>']) {
      expect(code(SRC), `must not offer ${bulk}`).not.toContain(bulk);
    }
  });

  it("says explicitly that an empty list is not 'everything'", () => {
    const h = handler('get', '/api/products/:productId/eligibility');
    expect(h).toContain('declared:');
    expect(h).toContain('not the same as every destination being eligible');
  });

  it("the rollover endpoint reports and carries nothing", () => {
    const h = code(handler('get', '/api/products/eligibility/rollover'));
    expect(h).toContain('describeVersionRollover');
    expect(h).not.toContain('grantEligibility');
    expect(handler('get', '/api/products/eligibility/rollover')).toContain('Reported only');
  });
});

describe("writes are attributable and audited", () => {
  it("both writes refuse an unattributable caller", () => {
    for (const [verb, path] of [
      ['post', '/api/products/:productId/eligibility'],
      ['post', '/api/products/:productId/eligibility/:destinationId/withdraw'],
    ] as const) {
      const h = code(handler(verb, path));
      expect(h, `${verb} ${path}`).toContain('actorId(req)');
      expect(h, `${verb} ${path}`).toContain('401');
    }
  });

  it("both write an audit event naming the pairing", () => {
    expect(code(handler('post', '/api/products/:productId/eligibility'))).toContain('PRODUCT_ELIGIBILITY_GRANTED');
    expect(code(handler('post', '/api/products/:productId/eligibility'))).toContain('PRODUCT_ELIGIBILITY_REGRANTED');
    expect(code(handler('post', '/api/products/:productId/eligibility/:destinationId/withdraw'))).toContain('PRODUCT_ELIGIBILITY_WITHDRAWN');
  });

  it("withdrawal is logged at warning, because it removes what a product can be priced and pushed on", () => {
    expect(code(handler('post', '/api/products/:productId/eligibility/:destinationId/withdraw'))).toContain("severity: 'warning'");
    expect(code(handler('post', '/api/products/:productId/eligibility'))).toContain("severity: 'info'");
  });

  it("withdrawal is a POST, not a DELETE — nothing is deleted", () => {
    expect(SRC).not.toMatch(/app\.delete\(/);
  });
});
