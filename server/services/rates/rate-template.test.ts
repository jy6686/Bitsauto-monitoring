import { describe, it, expect } from "vitest";
import {
  splitCsvLine, buildTemplateCsv, parseTemplateCsv, validateTemplate,
  expandTemplate, previousDay, type TemplateProduct,
} from "./rate-template";

const PRODUCTS: TemplateProduct[] = [
  { id: 1, code: "FC", name: "First Class" },
  { id: 2, code: "BC", name: "Business Class" },
  { id: 6, code: "SB", name: "Special Bravo" },
  { id: 7, code: "SC", name: "Special Charlie" },
];

const FULL = [
  "prefix,destination,FC,BC,SB,SC",
  "92,PAKISTAN FIXED,0.0450,0.0400,0.0350,0.0300",
  "9233,PAKISTAN MOBILE UFONE,0.0480,0.0420,0.0370,0.0320",
].join("\n");

describe("splitCsvLine", () => {
  it("keeps a quoted comma inside one field", () => {
    // Real destination names contain commas. A naive split shifts every price one column
    // left, pricing one destination at another's rate — invisible until a customer's bill.
    expect(splitCsvLine('9233,"PAKISTAN MOBILE, UFONE",0.048,0.042'))
      .toEqual(["9233", "PAKISTAN MOBILE, UFONE", "0.048", "0.042"]);
  });

  it("unescapes doubled quotes", () => {
    expect(splitCsvLine('92,"A ""B"" C",0.04')).toEqual(["92", 'A "B" C', "0.04"]);
  });
});

describe("buildTemplateCsv", () => {
  it("emits a header and one blank-priced line per destination", () => {
    const csv = buildTemplateCsv(
      [{ prefix: "92", destination: "PAKISTAN FIXED" }, { prefix: "91", destination: "INDIA FIXED" }],
      PRODUCTS,
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("prefix,destination,FC,BC,SB,SC");
    expect(lines[1]).toBe("92,PAKISTAN FIXED,,,,");
    expect(lines).toHaveLength(3);
  });

  it("quotes a destination containing a comma so its own output can be re-read", () => {
    const csv = buildTemplateCsv([{ prefix: "92", destination: "PAK, FIXED" }], PRODUCTS);
    expect(csv.split("\n")[1]).toBe('92,"PAK, FIXED",,,,');
    expect(parseTemplateCsv(csv, PRODUCTS).rows[0].destination).toBe("PAK, FIXED");
  });
});

describe("parseTemplateCsv", () => {
  it("reads prices into the right product columns", () => {
    const { rows, issues } = parseTemplateCsv(FULL, PRODUCTS);
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].prices).toEqual({ FC: 0.045, BC: 0.04, SB: 0.035, SC: 0.03 });
    expect(rows[1].destination).toBe("PAKISTAN MOBILE UFONE");
  });

  it("reports a missing product column ONCE, not once per row", () => {
    const csv = "prefix,destination,FC,BC,SB\n92,PK,0.045,0.04,0.035\n91,IN,0.02,0.018,0.016";
    const { issues } = parseTemplateCsv(csv, PRODUCTS);
    const sc = issues.filter(i => i.message.includes("SC"));
    expect(sc).toHaveLength(1);
    expect(sc[0].line).toBe(1);
  });

  it("rejects a non-numeric prefix and names the line", () => {
    const { issues } = parseTemplateCsv("prefix,destination,FC,BC,SB,SC\n+92,PK,1,1,1,1", PRODUCTS);
    expect(issues[0].line).toBe(2);
    expect(issues[0].message).toMatch(/not digits/);
  });

  it("rejects a non-numeric and a negative price", () => {
    const { issues } = parseTemplateCsv(
      "prefix,destination,FC,BC,SB,SC\n92,PK,abc,-0.01,1,1", PRODUCTS);
    expect(issues.map(i => i.message).join(" ")).toMatch(/FC price "abc" is not a number/);
    expect(issues.map(i => i.message).join(" ")).toMatch(/BC price -0.01 is negative/);
  });

  it("treats a blank cell as a gap, not a zero", () => {
    const { rows } = parseTemplateCsv("prefix,destination,FC,BC,SB,SC\n92,PK,0.045,,0.035,0.03", PRODUCTS);
    expect(rows[0].prices.BC).toBeUndefined();
    expect("BC" in rows[0].prices).toBe(false);
  });

  it("refuses a file whose header was edited away", () => {
    const { issues } = parseTemplateCsv("dest,FC\nPK,0.04", PRODUCTS);
    expect(issues[0].message).toMatch(/No "prefix" column/);
  });
});

describe("validateTemplate", () => {
  it("passes a fully priced sheet", () => {
    const { rows } = parseTemplateCsv(FULL, PRODUCTS);
    expect(validateTemplate(rows, PRODUCTS)).toEqual([]);
  });

  it("errors on a duplicate prefix and names the earlier line", () => {
    const csv = FULL + "\n92,PAKISTAN AGAIN,0.09,0.09,0.09,0.09";
    const { rows } = parseTemplateCsv(csv, PRODUCTS);
    const dupe = validateTemplate(rows, PRODUCTS).filter(i => i.message.includes("appears again"));
    expect(dupe).toHaveLength(1);
    expect(dupe[0].message).toMatch(/first on line 2/);
  });

  it("errors on a destination missing one product's price", () => {
    const { rows } = parseTemplateCsv("prefix,destination,FC,BC,SB,SC\n92,PK,0.045,,0.035,0.03", PRODUCTS);
    const errs = validateTemplate(rows, PRODUCTS).filter(i => i.severity === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toMatch(/no BC price.*unpriced/);
  });

  it("warns rather than errors on a deliberate zero", () => {
    const { rows } = parseTemplateCsv("prefix,destination,FC,BC,SB,SC\n92,PK,0,0.04,0.035,0.03", PRODUCTS);
    const issues = validateTemplate(rows, PRODUCTS);
    expect(issues.filter(i => i.severity === "error")).toHaveLength(0);
    expect(issues.filter(i => i.severity === "warning")[0].message).toMatch(/priced 0 on FC/);
  });

  it("errors on an empty sheet rather than importing nothing", () => {
    expect(validateTemplate([], PRODUCTS)[0].message).toMatch(/leave product_rates empty/);
  });
});

describe("expandTemplate", () => {
  it("fans 2 destinations x 4 products into 8 normalised rows", () => {
    const { rows } = parseTemplateCsv(FULL, PRODUCTS);
    const out = expandTemplate(rows, PRODUCTS);
    expect(out).toHaveLength(8);
    expect(out.find(r => r.productCode === "SB" && r.prefix === "9233")).toMatchObject({ productId: 6, rate: 0.037 });
  });

  it("carries the rate through without rounding", () => {
    const { rows } = parseTemplateCsv("prefix,destination,FC,BC,SB,SC\n92,PK,0.012345,1,1,1", PRODUCTS);
    expect(expandTemplate(rows, PRODUCTS)[0].rate).toBe(0.012345);
  });

  it("omits a gap instead of writing 0", () => {
    // Writing 0 for a missing price would make a destination free rather than unpriced —
    // the failure would be revenue, not an error.
    const { rows } = parseTemplateCsv("prefix,destination,FC,BC,SB,SC\n92,PK,0.045,,0.035,0.03", PRODUCTS);
    const out = expandTemplate(rows, PRODUCTS);
    expect(out).toHaveLength(3);
    expect(out.some(r => r.productCode === "BC")).toBe(false);
  });
});

describe("previousDay", () => {
  it("closes the prior generation the day before the new one starts", () => {
    expect(previousDay("2026-08-01")).toBe("2026-07-31");
  });

  it("handles the year boundary", () => {
    expect(previousDay("2027-01-01")).toBe("2026-12-31");
  });

  it("throws on a malformed date rather than expiring rates at an epoch", () => {
    expect(() => previousDay("01/08/2026")).toThrow(/YYYY-MM-DD/);
  });
});
