#!/usr/bin/env node
/**
 * verify-send-rate.mjs — assert Send Rate can do what it claims, and did.
 *
 *   node scripts/verify-send-rate.mjs                 # inspects the most recent push
 *   node scripts/verify-send-rate.mjs --job job-1787…  # inspects one specific push
 *
 * Reads DATABASE_URL from the environment, which a Replit shell already has set.
 *
 * ── What a script can and cannot prove here ───────────────────────────────────────────
 * The chain is: picker → selection → prefix expansion → queue → request → rate_push_jobs →
 * Sippy. Two links are not script-verifiable and pretending otherwise would be worse than
 * leaving them out:
 *
 *   the QUEUE lives in React state, reachable only from a browser;
 *   the SIPPY WRITE has an effect on a live switch, and a script that performs one to prove
 *   it works has changed a customer's tariff to make a test pass.
 *
 * So this proves everything up to the request, and then INSPECTS the most recent real push to
 * confirm the expansion survived into the database. Do one push by hand; this tells you
 * whether it landed correctly. That split is deliberate: the parts a machine can check
 * without consequences, and one deliberate human action it can then audit.
 *
 * --job pins the inspection to one push. Without it the newest is used, and on a shared system
 * someone else's push can land between yours and this run — the verifier would then report on
 * a job you never made, pass or fail, and either answer would be about the wrong thing.
 */
import { connect, run } from './lib/verify.mjs';

const jobArg = process.argv.includes('--job') ? process.argv[process.argv.indexOf('--job') + 1] : null;

const db = await connect();
const r = run(jobArg
  ? `Send Rate — readiness, then evidence from push ${jobArg}`
  : 'Send Rate — readiness, then evidence from the most recent push');
try {
  // ── Readiness: could a push be composed at all? ──────────────────────────────────
  const cat = await db.row(`SELECT
      (SELECT count(*)::int FROM v_catalogue_sellable)                            AS sellable,
      (SELECT label FROM catalogue_versions WHERE status='active')                AS active`);
  r.fatal('catalogue is live', cat.sellable > 0, `${cat.sellable} sellable · ${cat.active ?? 'no active version'}`);

  // The picker's own shape: a country must reach a destination, and that destination must
  // carry prefixes. A country with no reachable prefix is a dead end in the UI.
  const reach = await db.row(`SELECT count(*)::int n FROM v_catalogue_sellable s
      JOIN commercial_destination_prefixes p ON p.destination_id = s.id`);
  r.check('destinations reachable with prefixes', reach.n > 0, `${reach.n} destination-prefix pairs`);

  // Multi-prefix expansion is the behaviour Send Rate exists to deliver. If no destination in
  // the catalogue owns more than one prefix, the feature is untestable here and saying so is
  // more useful than a green tick.
  const multi = await db.row(`SELECT count(*)::int n, max(c) AS most FROM (
      SELECT destination_id, count(*)::int c FROM commercial_destination_prefixes
       GROUP BY destination_id HAVING count(*) > 1) x`);
  r.check('multi-prefix destinations exist', multi.n > 0,
          `${multi.n} destinations, largest owns ${multi.most}`,
          'without one, per-prefix expansion cannot be demonstrated');

  const zong = await db.all(`SELECT p.prefix FROM commercial_destination_prefixes p
      JOIN v_catalogue_sellable s ON s.id = p.destination_id
     WHERE s.name = 'PAKISTAN - MOBILE ZONG' ORDER BY p.prefix`);
  r.check('the worked example expands', zong.length === 2,
          zong.map(x => x.prefix).join(', ') || 'not found',
          'PAKISTAN - MOBILE ZONG should own 9231 and 9237');

  // ── Evidence: did a real push actually expand? ───────────────────────────────────
  const job = jobArg
    ? await db.row(`SELECT job_id, destination_name, full_prefix, status, created_at
        FROM rate_push_jobs WHERE job_id = $1`, [jobArg])
    // created_at DESC alone is non-deterministic: two pushes in the same second tie, and the
    // database is free to return either. id breaks the tie, so "the most recent" means one
    // specific row rather than whichever the planner reached first.
    : await db.row(`SELECT job_id, destination_name, full_prefix, status, created_at
        FROM rate_push_jobs ORDER BY created_at DESC, id DESC LIMIT 1`);
  if (!job.job_id) {
    r.check('a real push has been made', false,
            jobArg ? `no job with id ${jobArg}` : 'rate_push_jobs is empty',
            jobArg
              ? 'check the id — Push History shows jobs from rate_notification_jobs too, keyed job_ref not job_id'
              : 'do one push from Send Rate, then re-run — this is the half a script cannot perform for you');
  } else {
    const parts = String(job.full_prefix ?? '').split(',').map(s => s.trim()).filter(Boolean);
    r.check('last push recorded', true, `${job.job_id} · ${job.destination_name ?? '—'} · ${job.status}`);
    r.check('pushed prefixes carry a trunk digit', parts.every(p => /^[1267]/.test(p)),
            parts.join(', ') || '(none)',
            'full_prefix should be trunkPrefix + dialPrefix for every entry');
    // Only assertable when the pushed destination owns several prefixes — a single-prefix
    // destination producing one entry is correct, not a failure.
    const owned = await db.row(`SELECT count(*)::int n FROM commercial_destination_prefixes p
        JOIN commercial_destinations d ON d.id = p.destination_id
       WHERE d.name = $1`, [job.destination_name]);
    if (owned.n > 1) {
      r.check('expansion reached the push body', parts.length === owned.n,
              `${parts.length} pushed vs ${owned.n} owned`,
              'the destination owns more prefixes than were pushed — expansion stopped at the queue');
    }
  }
  r.report();
} finally { await db.close(); }
r.exit();
