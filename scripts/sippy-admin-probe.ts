/**
 * sippy-admin-probe.ts — answer "can we actually call an admin XML-RPC method?"
 *
 *   npx tsx scripts/sippy-admin-probe.ts
 *
 * WHY THIS EXISTS
 * POST /api/sippy/test cannot answer this question. testSippyConnection() tries XML-RPC
 * first and, on a 401, falls through to a WEB PORTAL LOGIN and still reports
 * { authenticated: true, mode: 'portal' }. That is correct behaviour for "is the switch
 * reachable and are the credentials real", but it means the connection test goes green
 * while every admin method — createAccount, the authentication rules, the routing group
 * assignment — returns 401. Provisioning then fails at its first write and looks like an
 * application bug.
 *
 * Authentication and authorisation are different questions. This probe asks the second
 * one, by calling listAccounts, a genuine admin method, through the exact function
 * production uses (sippy.listSippyAccounts) rather than a reimplementation that might
 * authenticate differently.
 *
 * The platform does not have one credential pair — routes.ts builds up to six from the
 * settings row (admin, portal, adminWebPassword combos, and the two cross-combos that
 * cover swapped DB fields) and tries each in turn. So "401" in a log means all six
 * failed. This prints the verdict PER PAIR, which distinguishes "no admin credential is
 * configured anywhere" from "the right one exists but is being tried too late".
 *
 * Passwords are never printed — only which settings field each came from, and its length.
 * Read-only: listAccounts creates nothing and changes nothing.
 */
import { Pool } from "pg";
import * as sippy from "../server/sippy";

type Pair = { username: string; password: string; origin: string };

function buildPairs(s: Record<string, string | null>): Pair[] {
  const pairs: Pair[] = [];
  const seen = new Set<string>();
  const push = (username: string | null, password: string | null, origin: string) => {
    if (!username || !password) return;
    const k = `${username}\x00${password}`;
    if (seen.has(k)) return;
    seen.add(k);
    pairs.push({ username, password, origin });
  };
  // Same order as sippyXmlCredsPairs() in server/routes.ts — the order matters, because
  // a working pair that is tried sixth still costs five failed round-trips per call.
  push(s.api_admin_username, s.api_admin_password, "apiAdmin user + apiAdmin password");
  push(s.portal_username, s.portal_password, "portal user + portal password");
  if (s.admin_web_password) {
    push(s.api_admin_username, s.admin_web_password, "apiAdmin user + adminWebPassword");
    push(s.portal_username, s.admin_web_password, "portal user + adminWebPassword");
  }
  if (s.portal_username !== s.api_admin_username) {
    push(s.portal_username, s.api_admin_password, "portal user + apiAdmin password (cross)");
    push(s.api_admin_username, s.portal_password, "apiAdmin user + portal password (cross)");
  }
  return pairs;
}

/**
 * Any existing tariff id, purely as a target for the upload-token probe. Read-only, and
 * the token is never used — which tariff it names is irrelevant.
 *
 * Deliberately NOT getTariffsList(): that function reads module-level `activeSession`
 * and throws 'No active Sippy session' outside the running app, so in a standalone
 * script it reports "no tariffs" on a switch holding 54 of them. Everything here takes
 * portalUrl explicitly instead.
 */
async function firstTariffId(p: Pair, portalUrl: string): Promise<number | null> {
  try {
    // A handful, not one: an account can carry no tariff, and giving up after the first
    // would report the API unavailable when it is simply that account.
    const { accounts, error } = await sippy.listSippyAccounts(p.username, p.password, { limit: 10 }, portalUrl);
    if (error) return null;
    for (const a of accounts) {
      const info = await sippy.getAccountInfo(p.username, p.password, portalUrl, Number(a.iAccount));
      if (info?.iTariff) return Number(info.iTariff);
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set — run this from the app environment.");
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url });
  const { rows } = await pool.query(`
    SELECT portal_url, portal_username, portal_password,
           api_admin_username, api_admin_password, admin_web_password
      FROM settings ORDER BY id LIMIT 1
  `);
  await pool.end();

  if (!rows.length) {
    console.error("No settings row — Sippy has never been configured on this database.");
    process.exit(2);
  }
  const s = rows[0];
  const portalUrl: string = s.portal_url ?? "";
  if (!portalUrl) {
    console.error("settings.portal_url is empty — nothing to probe.");
    process.exit(2);
  }

  const pairs = buildPairs(s);
  console.log(`Sippy admin probe — listAccounts against ${portalUrl}`);
  console.log(`${pairs.length} credential pair(s) configured.\n`);

  if (!pairs.length) {
    console.error("No usable credential pair. Both the admin and portal fields are incomplete.");
    process.exit(1);
  }

  let anyOk = false;
  let workingIndex = -1;
  for (const [i, p] of pairs.entries()) {
    const label = `${i + 1}. ${p.origin} — user "${p.username}", password ${p.password.length} chars`;
    const started = Date.now();
    let verdict: string;
    try {
      // limit 1: this is a permission probe, not a data pull.
      const r = await sippy.listSippyAccounts(p.username, p.password, { limit: 1 }, portalUrl);
      const ms = Date.now() - started;
      if (!r.error) {
        if (!anyOk) workingIndex = i;
        anyOk = true;
        // limit:1 above — "1 account" is this probe's own cap, not your account count.
        verdict = `OK   (${ms}ms) — admin method succeeded, ${r.accounts.length} account(s) returned (limit 1)`;
      } else if (r.error === "HTTP 401") {
        verdict = `401  (${ms}ms) — rejected. Credentials not accepted for admin XML-RPC.`;
      } else if (r.error === "HTTP 403") {
        verdict = `403  (${ms}ms) — authenticated but NOT authorised. This user is not an admin.`;
      } else {
        verdict = `FAIL (${ms}ms) — ${r.error}`;
      }
    } catch (e: any) {
      verdict = `ERROR (${Date.now() - started}ms) — ${e?.message ?? e}`;
    }
    console.log(`${label}\n     ${verdict}\n`);
  }

  if (anyOk) {
    console.log("VERDICT: at least one credential pair can call admin XML-RPC.");
    console.log("If a LATER pair is the working one, move it into the apiAdmin fields — every admin call currently");
    console.log("pays the failed attempts ahead of it on every request.\n");

    // ── Bulk-upload availability ──────────────────────────────────────────────
    // listAccounts is a READ. It proves the credential authenticates and is authorised
    // for admin methods; it does not prove the bulk-upload API exists on this build.
    // Those are different failures with different fixes, and conflating them is how the
    // tariff-33 rate-push defect stayed unexplained: "0/1 succeeded" was read as a
    // permissions problem when the build simply predates several modern methods.
    //
    // Non-destructive: a token is requested and discarded. Nothing is uploaded, nothing
    // is created, no cleanup is needed. Deliberately NOT createTariff/createAccount —
    // those leave real objects on a production switch.
    const working = pairs[workingIndex];
    const tariff = await firstTariffId(working, portalUrl);
    if (tariff === null) {
      console.log("getUploadToken: SKIPPED — no tariff available to probe against.");
      process.exit(0);
    }
    const probe = await sippy.probeUploadToken(working.username, working.password, portalUrl, tariff);
    if (probe.ok) {
      console.log(`getUploadToken (tariff ${tariff}): OK — token issued, upload URL returned.`);
      console.log("The bulk-upload API is available. A rate-push failure from here is in the workbook,");
      console.log("the import, or the read-back — not in authentication or method availability.");
      process.exit(0);
    }
    console.log(`getUploadToken (tariff ${tariff}): FAILED — ${probe.error}`);
    console.log("Admin XML-RPC works but the bulk-upload API does not answer. This is the mechanism behind");
    console.log("the tariff-33 rate-push defect. A rate upload cannot be automated until it is resolved;");
    console.log("importing a workbook through the Sippy UI still works and remains the manual path.");
    process.exit(1);
  }

  console.log("VERDICT: no configured credential can call an admin XML-RPC method.");
  console.log("Provisioning will fail at its first Sippy write (account creation), before authentication or routing.");
  console.log("This is resolved on the Sippy side — an XML-RPC API user with admin rights — not in this codebase.");
  console.log("A 401 across every pair means no admin credential is stored; a 403 means one authenticates but lacks rights.");
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
