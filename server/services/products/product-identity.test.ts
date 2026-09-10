/**
 * What a product needs to be usable, and the three ways the registry let one be created without it.
 *
 * All three were found by audit on 2026-09-10, not by a failure report, which is why they had
 * survived: a product missing a trunk prefix is not broken, it is merely unpushable; a product
 * created as 'active' is not broken, it is merely invisible.
 */
import { describe, it, expect } from "vitest";
import {
  validateProductInput, describeTrunkSharing,
  PRODUCT_STATUSES, PRODUCT_SEGMENTS, EDITABLE_PRODUCT_FIELDS,
} from "./product-identity";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ok = (r: ReturnType<typeof validateProductInput>) => {
  if (!r.ok) throw new Error('expected ok, got ' + JSON.stringify(r.errors));
  return r.value;
};
const errs = (r: ReturnType<typeof validateProductInput>) => {
  if (r.ok) throw new Error('expected errors, got ' + JSON.stringify(r.value));
  return r.errors;
};

describe("trunk prefix — what makes a product pushable at all", () => {
  it("REGRESSION: it is now accepted on create, where it used to be silently dropped", () => {
    // POST destructured code/name/description/status/colour/templates/... and never trunkPrefix,
    // so every product added through the platform was refused by push-batch as having none.
    const v = ok(validateProductInput({ code: 'PREM', name: 'Premium', trunkPrefix: '1' }));
    expect(v.trunkPrefix).toBe('1');
  });

  it("refuses a non-numeric trunk, and says why it cannot work", () => {
    const e = errs(validateProductInput({ code: 'X', name: 'X', trunkPrefix: '1a' }));
    expect(e[0].field).toBe('trunkPrefix');
    expect(e[0].message).toContain('digits only');
    expect(e[0].message).toContain('Sippy prefix');
  });

  it("allows it to be cleared, which makes the product unpushable rather than invalid", () => {
    for (const blank of ['', '   ', null]) {
      expect(ok(validateProductInput({ trunkPrefix: blank }, { partial: true })).trunkPrefix).toBeNull();
    }
  });

  it("refuses a trunk longer than the column", () => {
    expect(errs(validateProductInput({ code: 'X', name: 'X', trunkPrefix: '123456789' }))[0].field).toBe('trunkPrefix');
  });
});

describe("segment — wholesale and retail, instead of NULL meaning wholesale by accident", () => {
  it("accepts both, case-insensitively", () => {
    expect(ok(validateProductInput({ code: 'A', name: 'A', segment: 'Retail' })).segment).toBe('retail');
    expect(ok(validateProductInput({ code: 'B', name: 'B', segment: 'WHOLESALE' })).segment).toBe('wholesale');
  });

  it("refuses anything else rather than storing it", () => {
    const e = errs(validateProductInput({ code: 'A', name: 'A', segment: 'enterprise' }));
    expect(e[0].message).toContain('wholesale, retail');
  });

  it("still allows NULL, because the four live products are NULL and read as wholesale", () => {
    expect(ok(validateProductInput({ segment: '' }, { partial: true })).segment).toBeNull();
  });
});

describe("status — the value that was written and never read", () => {
  it("a new product is 'draft', not the 'active' that made it invisible", () => {
    // Every commercial surface filters status = 'commercial'. 'active' matched nothing, so a
    // product created through the API was present and absent at the same time.
    expect(ok(validateProductInput({ code: 'A', name: 'A' })).status).toBe('draft');
  });

  it("refuses 'active' explicitly, and explains what it used to do", () => {
    const e = errs(validateProductInput({ code: 'A', name: 'A', status: 'active' }));
    expect(e[0].field).toBe('status');
    expect(e[0].message).toContain('invisible');
  });

  it("accepts the vocabulary that is actually read", () => {
    for (const s of PRODUCT_STATUSES) {
      expect(ok(validateProductInput({ code: 'A', name: 'A', status: s })).status).toBe(s);
    }
  });

  it("an edit that does not mention status leaves it alone", () => {
    expect('status' in ok(validateProductInput({ name: 'Renamed' }, { partial: true }))).toBe(false);
  });
});

describe("the write allowlist — the edit endpoint used to accept the whole body", () => {
  it("REGRESSION: id, createdAt and unknown columns are dropped, not written", () => {
    // `db.update(productRegistry).set(req.body)` let any caller set any column, including the
    // primary key and the unique code.
    const v = ok(validateProductInput({
      code: 'A', name: 'A',
      id: 999, createdAt: '1970-01-01', updatedAt: 'x', somethingAddedLater: true,
    } as any));
    expect(v).not.toHaveProperty('id');
    expect(v).not.toHaveProperty('createdAt');
    expect(v).not.toHaveProperty('somethingAddedLater');
  });

  it("refuses by omission, so a column added tomorrow is not writable by default", () => {
    expect(EDITABLE_PRODUCT_FIELDS).not.toContain('id' as any);
    expect(EDITABLE_PRODUCT_FIELDS).toContain('trunkPrefix');
    expect(EDITABLE_PRODUCT_FIELDS).toContain('segment');
  });

  it("keeps the commercial fields that were already editable", () => {
    const v = ok(validateProductInput({ code: 'A', name: 'A', minMarginPct: 12, sortOrder: 3, color: 'violet' }));
    expect(v).toMatchObject({ minMarginPct: 12, sortOrder: 3, color: 'violet' });
  });
});

describe("code and name", () => {
  it("requires both on create and neither on edit", () => {
    expect(errs(validateProductInput({})).map(e => e.field).sort()).toEqual(['code', 'name']);
    expect(validateProductInput({ sortOrder: 1 }, { partial: true }).ok).toBe(true);
  });

  it("normalises code to upper case, since it is the unique business key", () => {
    expect(ok(validateProductInput({ code: 'prem', name: 'Premium' })).code).toBe('PREM');
  });

  it("refuses punctuation that would make a code unmatchable", () => {
    expect(errs(validateProductInput({ code: 'FC/RETAIL', name: 'x' }))[0].field).toBe('code');
  });

  it("refuses blank strings as firmly as missing ones", () => {
    expect(errs(validateProductInput({ code: '   ', name: '  ' })).length).toBe(2);
  });
});

describe("describeTrunkSharing — the wholesale/retail collision, surfaced early", () => {
  // The owner's intended set: 8 products, retail reusing the same four trunk prefixes.
  const EIGHT = [
    { id: 1, code: 'FC',   name: 'First Class Wholesale',    segment: 'wholesale', trunkPrefix: '1' },
    { id: 3, code: 'BC',   name: 'Business Class Wholesale', segment: 'wholesale', trunkPrefix: '2' },
    { id: 4, code: 'SB',   name: 'Special Bravo Wholesale',  segment: 'wholesale', trunkPrefix: '6' },
    { id: 5, code: 'SC',   name: 'Special Charlie Wholesale',segment: 'wholesale', trunkPrefix: '7' },
    { id: 6, code: 'PREM', name: 'Premium',                  segment: 'retail',    trunkPrefix: '1' },
    { id: 7, code: 'BUS',  name: 'Business',                 segment: 'retail',    trunkPrefix: '2' },
    { id: 8, code: 'SBR',  name: 'Special Bravo Retail',     segment: 'retail',    trunkPrefix: '6' },
    { id: 9, code: 'SCR',  name: 'Special Charlie Retail',   segment: 'retail',    trunkPrefix: '7' },
  ];

  it("reports the four intended pairings as ACROSS segments, not as errors", () => {
    const r = describeTrunkSharing(EIGHT);
    expect(r.map(x => x.trunkPrefix)).toEqual(['1', '2', '6', '7']);
    expect(r.every(x => x.acrossSegments)).toBe(true);
    expect(r.every(x => x.withinSegment)).toBe(false);
    expect(r[0].products.map(p => p.code)).toEqual(['FC', 'PREM']);
  });

  it("flags the one shape with no legitimate reading: two products, same trunk, same segment", () => {
    // A customer cannot hold two wholesale products on trunk 1 without the same full prefix being
    // written twice into one tariff.
    const r = describeTrunkSharing([
      { id: 1, code: 'FC',  name: 'First Class', segment: 'wholesale', trunkPrefix: '1' },
      { id: 2, code: 'FC2', name: 'Another',     segment: 'wholesale', trunkPrefix: '1' },
    ]);
    expect(r[0].withinSegment).toBe(true);
    expect(r[0].acrossSegments).toBe(false);
  });

  it("treats a NULL segment as wholesale, matching how the rest of the codebase reads it", () => {
    const r = describeTrunkSharing([
      { id: 1, code: 'FC',   name: 'First Class', segment: null,     trunkPrefix: '1' },
      { id: 6, code: 'PREM', name: 'Premium',     segment: 'retail', trunkPrefix: '1' },
    ]);
    expect(r[0].acrossSegments).toBe(true);   // NULL read as wholesale, so this pairs correctly
    expect(r[0].withinSegment).toBe(false);
  });

  it("says nothing about a product that is alone on its trunk, or has none", () => {
    expect(describeTrunkSharing([
      { id: 1, code: 'FC', name: 'First Class', segment: 'wholesale', trunkPrefix: '1' },
      { id: 2, code: 'NP', name: 'No prefix',   segment: 'retail',    trunkPrefix: null },
      { id: 3, code: 'BL', name: 'Blank',       segment: 'retail',    trunkPrefix: '  ' },
    ])).toEqual([]);
  });

  it("is empty for today's four products, which hold four distinct trunks", () => {
    expect(describeTrunkSharing([
      { id: 1, code: 'FC', name: 'First Class',     segment: null, trunkPrefix: '1' },
      { id: 3, code: 'BC', name: 'Business Class',  segment: null, trunkPrefix: '2' },
      { id: 4, code: 'SB', name: 'Special Bravo',   segment: null, trunkPrefix: '6' },
      { id: 5, code: 'SC', name: 'Special Charlie', segment: null, trunkPrefix: '7' },
    ])).toEqual([]);
  });
});

describe("the endpoints are gated and no longer mass-assign", () => {
  const SRC = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8');
  /** One handler's own text, bounded at the next route registration rather than a fixed window —
   *  a fixed window spills into the neighbouring endpoint and reads its statements as this one's. */
  const handler = (name: string, verb: string) => {
    const start = SRC.indexOf(`app.${verb}('/api/product-registry/${name}'`);
    if (start < 0) return '';
    const next = SRC.indexOf('\n  app.', start + 10);
    return SRC.slice(start, next < 0 ? undefined : next);
  };

  it("REGRESSION: create and edit require a role — they were ungated while every neighbouring rate endpoint was not", () => {
    for (const [name, verb] of [['products', 'post'], ['products/:id', 'put']] as const) {
      expect(handler(name, verb), `${verb} ${name}`).toContain("requireRole(['admin', 'management']");
    }
  });

  it("REGRESSION: edit no longer writes the request body straight into the UPDATE", () => {
    expect(handler('products/:id', 'put')).not.toContain('.set(req.body)');
    expect(handler('products/:id', 'put')).toContain('validateProductInput(req.body ?? {}, { partial: true })');
  });

  it("create validates instead of destructuring a list that omitted trunkPrefix and segment", () => {
    const post = handler('products', 'post');
    expect(post).toContain('validateProductInput(req.body ?? {})');
    expect(post).toContain('checked.value');
  });

  it("a duplicate code answers 409, not an opaque 500", () => {
    expect(handler('products', 'post')).toContain('409');
  });

  it("trunk sharing is exposed read-only, and performs no write", () => {
    const h = handler('trunk-sharing', 'get');
    expect(h).toContain('describeTrunkSharing');
    for (const w of ['db.insert(', 'db.update(', 'db.delete(']) expect(h).not.toContain(w);
  });
});
