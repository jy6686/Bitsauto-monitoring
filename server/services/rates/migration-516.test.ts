import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
let c: PGlite;
const MIG = readFileSync(join(process.cwd(), 'migrations', '516_billing_increment_changes.sql'), 'utf8');
beforeAll(async () => {
  c = await PGlite.create();
  await c.exec(`
    CREATE TABLE catalogue_versions (id SERIAL PRIMARY KEY, label TEXT UNIQUE NOT NULL, status TEXT NOT NULL);
    CREATE TABLE commercial_destinations (id SERIAL PRIMARY KEY, version_id INTEGER NOT NULL REFERENCES catalogue_versions(id), name TEXT NOT NULL);
    CREATE TABLE product_registry (id SERIAL PRIMARY KEY, code VARCHAR(16) UNIQUE NOT NULL, name VARCHAR(64) NOT NULL);
    INSERT INTO catalogue_versions (id,label,status) VALUES (1,'V1','active');
    INSERT INTO commercial_destinations (id,version_id,name) VALUES (10,1,'X');
    INSERT INTO product_registry (id,code,name) VALUES (1,'FC','First Class');`);
  await c.exec(MIG);
});
afterAll(async () => { await c?.close(); });
const ins = (cols: string, vals: string) => c.exec(`INSERT INTO billing_increment_changes (${cols}) VALUES (${vals})`);
describe("migration 516", () => {
  it("creates the table empty", async () => {
    const r: any = await c.query(`SELECT count(*)::int AS n FROM billing_increment_changes`);
    expect(r.rows[0].n).toBe(0);
  });
  it("refuses a change from an increment to itself", async () => {
    await expect(ins("product_id,destination_id,catalogue_version_id,previous_increment,new_increment,effective_date,created_by",
      "1,10,1,'60/1','60/1','2026-09-20','op'")).rejects.toThrow(/bic_actually_changes/);
  });
  it("refuses an applied row with no operator", async () => {
    await expect(ins("product_id,destination_id,catalogue_version_id,previous_increment,new_increment,effective_date,created_by,status",
      "1,10,1,'60/1','30/6','2026-09-21','op','applied'")).rejects.toThrow(/bic_applied_attributable/);
  });
  it("refuses a failed row with no reason", async () => {
    await expect(ins("product_id,destination_id,catalogue_version_id,previous_increment,new_increment,effective_date,created_by,status",
      "1,10,1,'60/1','30/6','2026-09-22','op','failed'")).rejects.toThrow(/bic_failed_explained/);
  });
  it("allows one live change per destination per date, and refuses a second", async () => {
    await ins("product_id,destination_id,catalogue_version_id,previous_increment,new_increment,effective_date,created_by",
      "1,10,1,'60/1','30/6','2026-09-20','op'");
    await expect(ins("product_id,destination_id,catalogue_version_id,previous_increment,new_increment,effective_date,created_by",
      "1,10,1,'60/1','15/1','2026-09-20','op'")).rejects.toThrow(/bic_one_per_date_ux/);
  });
});
