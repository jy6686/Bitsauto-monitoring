/**
 * verify.mjs — shared primitives for the verify-*.mjs scripts.
 *
 * Extracted at the third consumer rather than the first: two scripts sharing an abstraction is
 * a guess about what they have in common, three is evidence.
 *
 * Every script that uses this reports the same way, exits the same way, and names the database
 * it spoke to before anything else — the two failures that cost most during this migration were
 * a query against the wrong database and a result read without knowing which one produced it.
 */
import { Pool } from 'pg';

export function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Refusing to guess a database — that is how ten migrations went missing.');
    process.exit(2);
  }
  return process.env.DATABASE_URL;
}

export async function connect() {
  const pool = new Pool({ connectionString: requireDatabaseUrl() });
  const client = await pool.connect();
  const row = async (text, params) => (await client.query(text, params)).rows[0] ?? {};
  const all = async (text, params) => (await client.query(text, params)).rows;
  const who = await row('SELECT current_database() db, inet_server_addr()::text host');
  console.log(`\ndatabase   ${who.db} @ ${who.host ?? 'local socket'}\n`);
  return { client, row, all, close: async () => { client.release(); await pool.end(); } };
}

/** A run collects checks and decides the exit code. Nothing prints until report(). */
export function run(title) {
  const results = [];
  return {
    /** `detail` is shown on pass and fail alike — a number is evidence, not just a diagnosis. */
    check(name, ok, detail, why) { results.push({ name, ok: !!ok, detail, why }); return !!ok; },
    /** Stop the run early when nothing below it could be meaningful. */
    fatal(name, ok, detail) {
      this.check(name, ok, detail);
      if (!ok) { this.report(); process.exit(1); }
      return ok;
    },
    results,
    report() {
      if (title) console.log(`${title}\n`);
      // Numbered, so a failure is locatable by position when someone reads it back over a
      // phone or pastes three lines out of the middle.
      const w = String(results.length).length;
      results.forEach((r, i) => {
        const n = `[${String(i + 1).padStart(w)}/${results.length}]`;
        console.log(`  ${n} ${r.ok ? '✓' : '✗'} ${String(r.name).padEnd(44)} ${r.detail ?? ''}`);
        if (!r.ok && r.why) console.log(`  ${' '.repeat(n.length)}     ${r.why}`);
      });
      const bad = results.filter(r => !r.ok);
      console.log(bad.length
        ? `\n✗ ${bad.length} of ${results.length} check(s) failed.\n`
        : `\n✓ all ${results.length} checks passed.\n`);
      return bad.length === 0;
    },
    exit() { process.exit(this.results.every(r => r.ok) ? 0 : 1); },
  };
}
