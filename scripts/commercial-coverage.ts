/**
 * commercial-coverage.ts — reconcile the commercial price list against the catalogue.
 *
 *   npx tsx scripts/commercial-coverage.ts
 *
 * Migration 052 matched 18 of the 32 owner-supplied prefixes to approved catalogue entries
 * and reported 14 as unmatched. "Unmatched" is not the same as "missing", and the
 * difference decides what to do about it:
 *
 *   923 did not match — but 9230, 9231, 9232, 9233, 9234, 9235 and 9237 all did. The
 *   catalogue models Pakistan Mobile as operator series; the commercial list prices it as
 *   one breakout. Both are correct at their own level, and the COMMERCIAL PARENT IS
 *   MISSING FROM THE CATALOGUE — it is not a redundant entry to delete.
 *
 *   A prefix with no catalogue entry and no children is a genuine gap: the business
 *   prices a destination the catalogue does not know about.
 *
 * Those need opposite actions, and the migration log cannot tell them apart. This does:
 * for each unmatched prefix it looks for catalogue entries that EXTEND it (children) and
 * for the approved ancestor that would already carry its traffic.
 *
 * Read-only. Changes nothing.
 */
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set."); process.exit(2); }
  const pool = new Pool({ connectionString: url });

  // The commercial list as seeded by migration 041.
  const { rows: wanted } = await pool.query<{ prefix: string; country: string; breakout: string }>(
    `SELECT DISTINCT e.prefix, e.country, e.breakout
       FROM rate_card_entries e
       JOIN rate_cards c ON c.id = e.rate_card_id
      WHERE c.name = 'Standard Wholesale' AND c.card_type = 'client'
        AND e.prefix IS NOT NULL
      ORDER BY e.prefix`,
  );
  if (!wanted.length) {
    console.error("No Standard Wholesale client rate card entries — migration 041 has not run here.");
    await pool.end(); process.exit(1);
  }

  const exact: string[] = [];
  // Named for what it is: a commercial-level node the catalogue lacks, evidenced by
  // operator-level children existing beneath it.
  const needsParent: Array<{ prefix: string; label: string; children: string[] }> = [];
  const covered: Array<{ prefix: string; label: string; by: string }> = [];
  const missing: Array<{ prefix: string; label: string }> = [];

  for (const w of wanted) {
    const label = `${w.country ?? '?'} / ${w.breakout ?? '?'}`;

    const { rows: hit } = await pool.query(
      `SELECT 1 FROM global_destinations
        WHERE dial_prefix = $1 AND commercial_status = 'approved' LIMIT 1`, [w.prefix]);
    if (hit.length) { exact.push(w.prefix); continue; }

    // Children: approved entries that extend this prefix. If they exist, the catalogue
    // models this destination more finely and the generic entry adds nothing — Sippy
    // matches longest-prefix, so an overlapping shorter one would never win.
    const { rows: kids } = await pool.query<{ dial_prefix: string }>(
      `SELECT dial_prefix FROM global_destinations
        WHERE commercial_status = 'approved'
          AND dial_prefix LIKE $1 || '%' AND dial_prefix <> $1
        ORDER BY dial_prefix LIMIT 12`, [w.prefix]);
    if (kids.length) {
      needsParent.push({ prefix: w.prefix, label, children: kids.map(k => k.dial_prefix) });
      continue;
    }

    // Ancestor: an approved shorter prefix that already carries this traffic. Pricing the
    // child would be a deliberate breakout, not a gap.
    const { rows: parent } = await pool.query<{ dial_prefix: string; name: string }>(
      `SELECT dial_prefix, name FROM global_destinations
        WHERE commercial_status = 'approved'
          AND $1 LIKE dial_prefix || '%' AND dial_prefix <> $1
        ORDER BY length(dial_prefix) DESC LIMIT 1`, [w.prefix]);
    if (parent.length) {
      covered.push({ prefix: w.prefix, label, by: `${parent[0].dial_prefix} ${parent[0].name}` });
      continue;
    }

    missing.push({ prefix: w.prefix, label });
  }

  await pool.end();

  console.log(`Commercial list: ${wanted.length} prefix(es) from migration 041\n`);
  console.log(`  ${exact.length} matched a catalogue entry exactly — already assignable`);
  console.log(`  ${needsParent.length} priced at commercial level, catalogue has only operator level — ADD A PARENT NODE`);
  console.log(`  ${covered.length} already carried by a broader approved entry`);
  console.log(`  ${missing.length} genuinely absent from the catalogue — NEEDS A DECISION\n`);

  if (needsParent.length) {
    console.log("── Commercial parent missing from the catalogue ────────────────────");
    console.log("   The catalogue models these as operator series; Commercial prices them as");
    console.log("   one breakout. Both are right at their own level.");
    console.log("");
    console.log("   DO NOT remove these from the commercial list. A generated tariff contains");
    console.log("   only the rows we put in it, so 1923 rates every 923xxxx call — the");
    console.log("   catalogue's finer entries are not in that tariff and do not compete with");
    console.log("   it. Pricing per operator series would mean thousands of rows per customer");
    console.log("   instead of 128.");
    console.log("");
    console.log("   Add a commercial node at this prefix (migration 053 does this), keeping");
    console.log("   the operator entries for routing, analytics and fraud.\n");
    for (const s of needsParent) {
      console.log(`   ${s.prefix.padEnd(8)} ${s.label}`);
      console.log(`            covered by: ${s.children.join(', ')}${s.children.length === 12 ? ' …' : ''}`);
    }
    console.log("");
  }

  if (covered.length) {
    console.log("── Already carried by a broader entry ──────────────────────────────");
    console.log("   Pricing these separately is a deliberate breakout, not a gap.\n");
    for (const c of covered) console.log(`   ${c.prefix.padEnd(8)} ${c.label}  ←  ${c.by}`);
    console.log("");
  }

  if (missing.length) {
    console.log("── Genuinely absent — the business prices what the catalogue lacks ──");
    console.log("   Add and approve these in the Destination Catalogue, then re-run 052.\n");
    for (const m of missing) console.log(`   ${m.prefix.padEnd(8)} ${m.label}`);
    console.log("");
  }

  console.log("Nothing was changed. Assignments are made on the Product Registry page,");
  console.log("or by re-running migration 052 after the catalogue is corrected.");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(2); });
