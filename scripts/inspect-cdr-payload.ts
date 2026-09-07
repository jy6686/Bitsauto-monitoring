/**
 * inspect-cdr-payload.ts — show the raw CDR Sippy returned for one account
 * on one day, exactly as the repository stored it. READ-ONLY.
 *
 * WHY. 2026-09-07: PUSHTOTALK's first rating under tariff 2 reproduced
 * ~$3 for a period Sippy charged ~$60. BitsAuto's tariff 2 is byte-identical
 * to Sippy's live tariff 2, the account's billing plan says tariff 2, and the
 * price Sippy actually charged (≈$0.0275/min) appears in no row of it. The
 * only thing that settles which rate Sippy applied — and whether the stored
 * `cost` is the customer charge at all — is the raw CDR, kept verbatim in
 * raw_sippy_cdrs.payload. No endpoint exposes it. This prints it.
 *
 * THE TRAP THIS SCRIPT EXISTS TO AVOID. In the Replit Shell, $DATABASE_URL is
 * the DEVELOPMENT database (helium/heliumdb). Production is neondb, reachable
 * only with the deployment's own DATABASE_URL. A query against dev returns an
 * answer that looks fine and is about the wrong data. So the first thing
 * printed is the database actually reached, and dev is refused unless you
 * say --allow-dev.
 *
 *   DATABASE_URL="<production URL from Deployment → Secrets>" \
 *     npx tsx scripts/inspect-cdr-payload.ts --account 1 --date 2026-09-04
 *
 * Options: --account <i_account> (default 1)  --date YYYY-MM-DD (default 2026-09-04)
 *          --limit <n> (default 1)  --allow-dev
 * Never paste the production URL anywhere but your own shell.
 */

import pg from 'pg';

const arg = (name: string, dflt: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const account  = Number(arg('account', '1'));
const date     = arg('date', '2026-09-04');
const limit    = Math.max(1, Math.min(20, Number(arg('limit', '1'))));
const allowDev = process.argv.includes('--allow-dev');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Export the PRODUCTION connection string for this one command.');
  process.exit(2);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(account) || account <= 0) {
  console.error('Usage: --account <positive int> --date YYYY-MM-DD [--limit n] [--allow-dev]');
  process.exit(2);
}

// Fields on a Sippy CDR that decide how it was priced. Printed first, by name,
// so the answer does not have to be dug out of the full payload.
const RATE_FIELDS = [
  'i_tariff', 'i_billing_plan', 'i_service_plan', 'i_account', 'i_customer',
  'cost', 'price_1', 'price_n', 'interval_1', 'interval_n', 'connect_fee',
  'post_call_surcharge', 'free_seconds', 'grace_period', 'charged_amount', 'payment_currency',
  'duration', 'billed_duration', 'total_duration', 'cld', 'cli', 'cld_in', 'cld_out',
  'prefix', 'destination', 'country', 'description', 'result', 'i_cdr', 'call_id',
];

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const who = await pool.query(`SELECT current_database() AS db, inet_server_addr()::text AS host, version() AS v`);
    const { db, host } = who.rows[0];
    console.log(`connected to database "${db}" at ${host ?? '(socket)'}`);
    if (/helium/i.test(String(db)) && !allowDev) {
      console.error('This is the DEVELOPMENT database. Production is "neondb". Refusing — set DATABASE_URL to the deployment\'s value, or pass --allow-dev if you really mean dev.');
      process.exit(3);
    }

    const rows = await pool.query(
      `SELECT i_cdr, cdr_call_id, callee, started_at, billed_secs, total_secs, cost, i_tariff, payload
         FROM raw_sippy_cdrs
        WHERE i_account = $1
          AND started_at >= $2::timestamptz
          AND started_at <  ($2::timestamptz + interval '1 day')
          AND cost IS NOT NULL AND cost > 0
        ORDER BY started_at
        LIMIT $3`,
      [account, `${date}T00:00:00Z`, limit],
    );
    if (rows.rowCount === 0) {
      console.log(`no repository rows with cost > 0 for account ${account} on ${date}`);
      process.exit(1);
    }

    for (const r of rows.rows) {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const billed = Number(r.billed_secs ?? 0);
      const perMin = billed > 0 ? (Number(r.cost) / billed) * 60 : null;
      console.log('\n──────────────────────────────────────────────────────────');
      console.log(`repository row  i_cdr=${r.i_cdr}  callee=${r.callee}  started=${new Date(r.started_at).toISOString()}`);
      console.log(`                billed_secs=${r.billed_secs}  total_secs=${r.total_secs}  cost=${r.cost}  i_tariff(column)=${r.i_tariff}`);
      console.log(`                implied rate from cost/billed = ${perMin == null ? 'n/a' : `$${perMin.toFixed(6)}/min`}`);
      console.log('rate-relevant payload fields:');
      for (const k of RATE_FIELDS) {
        if (k in p) console.log(`  ${k.padEnd(20)} ${JSON.stringify(p[k])}`);
      }
      const other = Object.keys(p).filter(k => !RATE_FIELDS.includes(k)).sort();
      console.log(`other payload keys (${other.length}): ${other.join(', ')}`);
      console.log('full payload:');
      console.log(JSON.stringify(p, null, 2));
    }
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error('failed:', e?.message ?? e); process.exit(1); });
