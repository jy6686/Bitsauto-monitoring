#!/usr/bin/env node
/**
 * verify-deployment.mjs — assert a deployment can actually sell something.
 *
 *   node scripts/verify-deployment.mjs https://your-app.example
 *
 * Exits 0 when ready, 1 when not. Intended as the last step of a deploy, because a process
 * that started cleanly and a process that can serve commercial traffic are different claims,
 * and today only the first one was being checked.
 *
 * Uses /api/commercial/ready, which is unauthenticated and returns one boolean. For the
 * reason behind a `false`, open /api/commercial/health while logged in — it names which of
 * the four causes applies rather than leaving it to be guessed.
 *
 * ── Where this can actually run ───────────────────────────────────────────────────────
 * Replit deployments sit behind __replshield, which 307-redirects unauthenticated requests
 * to a Replit login. So this CANNOT gate a Replit deployment from outside; measured against
 * production 2026-08-30 and it returned the redirect, not the probe.
 *
 * It works where there is no shield in front of the app:
 *   - from inside the container as a post-deploy step:  node scripts/verify-deployment.mjs http://localhost:5000
 *   - against the workspace:                            node scripts/verify-deployment.mjs http://localhost:5000
 *   - against any host where the shield is off
 *
 * The redirect is reported rather than treated as "not ready", because "I could not ask" and
 * "the answer is no" are different facts and a gate that conflates them teaches people to
 * ignore it.
 */
const base = process.argv[2]?.replace(/\/$/, '');
if (!base) {
  console.error('usage: node scripts/verify-deployment.mjs <base-url>');
  process.exit(2);
}
const url = `${base}/api/commercial/ready`;
try {
  const res = await fetch(url, { redirect: 'manual' });
  const body = await res.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = null; }

  if (parsed?.ready === true) {
    console.log(`✓ ${base} — commercial catalogue is live`);
    process.exit(0);
  }
  if (parsed?.ready === false) {
    console.error(`✗ ${base} — deployed, but NOTHING IS SELLABLE`);
    console.error('  The app is up and the commercial catalogue is empty, inactive, or unapproved.');
    console.error(`  Open ${base}/api/commercial/health signed in — it names which.`);
    process.exit(1);
  }
  // Neither shape: an older build without this endpoint, or a login wall in front of it.
  console.error(`✗ ${base} — HTTP ${res.status}, and the response is not this probe.`);
  console.error(`  Most likely an older build that predates /api/commercial/ready, or an auth`);
  console.error(`  redirect in front of it. First 120 bytes: ${body.slice(0, 120)}`);
  process.exit(1);
} catch (e) {
  console.error(`✗ ${base} — unreachable: ${e.message}`);
  process.exit(1);
}
