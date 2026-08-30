#!/usr/bin/env node
/**
 * verify-all.mjs — the release gate. Runs every verifier against DATABASE_URL and exits
 * non-zero if any fails.
 *
 *   node scripts/verify-all.mjs
 *
 * Run it against the database a deployment is about to serve. Today's incident is the case it
 * exists for: the build was fine, the deployment was fine, and the target database had no
 * catalogue — so shipping replaced a working picker with an empty one. This gate would have
 * refused that, naming the reason, before anyone opened a browser.
 *
 * It deliberately does NOT require that a human has performed a push. That is an acceptance
 * criterion for Send Rate, not a precondition for deploying code, and conflating them would
 * block every release onto a fresh database.
 */
import { spawnSync } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. The gate must know which database it is clearing.');
  process.exit(2);
}

const STEPS = [
  { name: 'catalogue',     cmd: 'node',    args: ['scripts/verify-catalogue.mjs'] },
  { name: 'send-rate',     cmd: 'node',    args: ['scripts/verify-send-rate.mjs', '--readiness-only'] },
  { name: 'rate-analysis', cmd: 'npx',     args: ['tsx', 'scripts/verify-rate-analysis.mjs'] },
];

const failed = [];
for (const s of STEPS) {
  console.log(`\n${'─'.repeat(72)}\n▶ ${s.name}\n${'─'.repeat(72)}`);
  const r = spawnSync(s.cmd, s.args, { stdio: 'inherit', env: process.env });
  // A verifier that could not run at all is a failure, not a skip: an absent answer must never
  // read as a passing one, which is the whole reason this gate exists.
  if (r.status !== 0) failed.push({ ...s, status: r.status ?? 'did not run' });
}

console.log(`\n${'═'.repeat(72)}`);
if (failed.length) {
  console.log(`✗ GATE FAILED — ${failed.map(f => `${f.name} (${f.status})`).join(', ')}`);
  console.log('  Do not deploy against this database. The output above names what is wrong.\n');
  process.exit(1);
}
console.log('✓ GATE PASSED — every verifier clears this database.\n');
