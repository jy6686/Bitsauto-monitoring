/**
 * Migration 520 — the enforcement switch, created OFF.
 *
 * DATABASE-BACKED: the migration file is read off disk and executed against the
 * platform_feature_flags shape from migration 0000. The row this creates is what turns the
 * policy layer on, so what is guarded is that it arrives disabled, that re-applying cannot flip
 * it, and that the key it registers is the SAME string the route reads — a flag under one name
 * and a route reading another would be a switch wired to nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(join(__dirname, '..', '..', '..', 'migrations', '520_rate_policy_enforcement_flag.sql'), 'utf8');
const KEY = 'rate_policy_enforcement';

let db: PGlite;
const one = async (q: string) => ((await db.query(q)) as any).rows[0];

beforeEach(async () => {
  db = await PGlite.create();
  // Shape from 0000_robust_iron_man.sql / shared/schema.ts platformFeatureFlags.
  await db.exec(`
    CREATE TABLE platform_feature_flags (
      key VARCHAR(64) PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      owner_role VARCHAR(32) NOT NULL,
      changed_by VARCHAR(255), changed_by_name VARCHAR(128),
      changed_at TIMESTAMP DEFAULT NOW(),
      reason TEXT, prev_state BOOLEAN);
    INSERT INTO platform_feature_flags (key, enabled, owner_role) VALUES
      ('forward_capture', TRUE, 'super_admin'), ('collection_recovery_mode', FALSE, 'super_admin');`);
});
afterEach(async () => { await db?.close(); });

describe("the switch arrives OFF, owned, and explained", () => {
  it("creates the row disabled", async () => {
    await db.exec(migration);
    const r = await one(`SELECT enabled, owner_role, reason FROM platform_feature_flags WHERE key = '${KEY}'`);
    expect(r).toBeDefined();
    expect(r.enabled).toBe(false);
    expect(r.owner_role).toBe('super_admin');
    expect(String(r.reason)).toMatch(/refused before write/);
    expect(String(r.reason)).toMatch(/When OFF, push-batch behaves as before/);
  });

  it("is idempotent, and a re-run CANNOT turn it on or reset a later decision", async () => {
    await db.exec(migration);
    // An operator later enables it, with attribution. Re-running the migration — which a
    // recovery or a redeploy could do — must leave that decision exactly where it was.
    await db.exec(`UPDATE platform_feature_flags SET enabled = TRUE, changed_by_name = 'Junaid', reason = 'go-live' WHERE key = '${KEY}'`);
    await db.exec(migration);
    const r = await one(`SELECT enabled, changed_by_name, reason FROM platform_feature_flags WHERE key = '${KEY}'`);
    expect(r.enabled).toBe(true);
    expect(r.changed_by_name).toBe('Junaid');
    expect(r.reason).toBe('go-live');
  });

  it("touches no other flag", async () => {
    await db.exec(migration);
    expect((await one(`SELECT count(*)::int AS n FROM platform_feature_flags`)).n).toBe(3);
    expect((await one(`SELECT enabled FROM platform_feature_flags WHERE key = 'forward_capture'`)).enabled).toBe(true);
    expect((await one(`SELECT enabled FROM platform_feature_flags WHERE key = 'collection_recovery_mode'`)).enabled).toBe(false);
  });

  it("fails loudly if the row is somehow not registered", () => {
    // The DO block is the convention 085/086 set: a flag migration that silently did nothing
    // would leave 'off' as an absence again, which is what this migration exists to end.
    expect(migration).toMatch(/RAISE EXCEPTION 'rate_policy_enforcement flag was not registered'/);
  });
});

describe("the key is ONE string, shared with the route", () => {
  it("registers exactly the key push-batch reads", () => {
    const route = readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(route).toContain(`eq(platformFeatureFlags.key, '${KEY}')`);
    expect(migration).toContain(`'${KEY}'`);
  });

  it("contains no destructive statement and touches only the flags table", () => {
    const code = migration.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
    expect(code.match(/\b(DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE)\b/gi)).toBeNull();
    expect(code.match(/\b(INSERT\s+INTO|UPDATE)\s+(\w+)/gi)?.every(m => /platform_feature_flags/.test(m))).toBe(true);
  });
});
