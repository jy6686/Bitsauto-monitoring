/**
 * migrate.ts — run pending migrations now, without restarting the app.
 *
 *   npx tsx scripts/migrate.ts            apply pending migrations
 *   npx tsx scripts/migrate.ts --status   show the ledger, apply nothing
 *
 * WHY
 * runFileMigrations() runs at startup, so applying a migration meant: pull, restart, read
 * the boot log, then run a verification script. That sequence has silently failed three
 * times in one day — twice because a restart never happened, and once because a "# restart
 * here" comment inside a shell block was pasted and ignored. Each time the symptom was a
 * verification script reporting unchanged numbers, which reads as a code defect rather
 * than a migration that never ran.
 *
 * The same runner, the same ledger, the same advisory lock — just invoked directly, so
 * "did it apply?" is answered by the command that applies it rather than inferred from a
 * count that did not move.
 *
 * Safe to run against a live app: LOCK_KEY serialises this against a concurrent boot, so
 * the two cannot apply the same file twice.
 */
import { pool } from "../server/db";
import { runFileMigrations, getMigrationLedger } from "../server/migrate";

async function showStatus() {
  const { rows, pending, drift, migrationsDir, baselineThrough } = await getMigrationLedger(pool);
  console.log(`migrations dir: ${migrationsDir ?? '(not found)'} · baselined through ${baselineThrough}`);
  console.log(`${rows.length} in ledger · ${pending.length} pending · ${drift.length} modified · ` +
              `${rows.filter(r => r.missingFromDisk).length} missing from disk\n`);

  for (const r of rows) {
    const state = r.missingFromDisk ? 'MISSING '
                : r.driftedTo       ? 'MODIFIED'
                : r.baselined       ? 'baseline'
                :                     'applied ';
    console.log(`  ${state}  ${r.filename}`);
    if (r.driftedTo) {
      console.log(`            recorded ${r.checksum}, now ${r.driftedTo} — not re-run, which is the rule`);
    }
  }
  for (const f of pending) console.log(`  PENDING   ${f}`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — run this from the app environment.");
    process.exit(2);
  }

  if (process.argv.includes("--status")) {
    await showStatus();
    await pool.end();
    process.exit(0);
  }

  console.log("Applying pending migrations…\n");
  const out = await runFileMigrations(pool);

  console.log("");
  if (out.skipped) {
    console.log("SKIPPED — the runner declined to act. Baseline validation failed; see above.");
    await pool.end();
    process.exit(1);
  }
  if (out.applied.length) {
    console.log(`Applied ${out.applied.length}:`);
    for (const f of out.applied) console.log(`  ${f}`);
  } else {
    console.log("Nothing pending — already up to date.");
  }
  for (const d of out.drifted) {
    console.log(`MODIFIED (not re-run): ${d.file}`);
  }
  if (out.failed) {
    // Exit non-zero so this cannot be mistaken for success in a script or a CI step.
    console.error(`\nFAILED: ${out.failed.file}\n  ${out.failed.error}`);
    console.error("Later migrations were NOT applied — the runner halts on first failure by design.");
    await pool.end();
    process.exit(1);
  }

  await pool.end();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(2); });
